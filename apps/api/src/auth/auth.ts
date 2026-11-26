import {
  accounts,
  findUserNameByEmail,
  normalizeEmail,
  passkeys,
  rateLimits,
  sessions,
  users,
  verifications,
  type Db,
} from "@padvinder/db";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import { eq } from "drizzle-orm";
import { scrub } from "@padvinder/logging";
import type { FastifyBaseLogger } from "fastify";
import type { ApiEnv } from "../env";
import { buildLoginCodeMail, describeMailError, type Mailer } from "@padvinder/mail";
import {
  checkLoginCodeRequest,
  IP_LIMITS,
  isValidLoginAddress,
  type LoginCodeLimit,
} from "./login-rate-limit";

export type AuthDeps = { env: ApiEnv; db: Db; mailer: Mailer; log: FastifyBaseLogger };

const DAY_SECONDS = 24 * 60 * 60;

/** The paths whose new session is made by a passkey, so it is stamped as confirmed. */
const PASSKEY_SESSION_PATHS = new Set([
  "/passkey/verify-authentication",
  "/passkey/verify-registration",
]);

/**
 * Every double-quoted value in a log message, replaced. SimpleWebAuthn quotes the challenge and
 * the origin in its errors (`Unexpected authentication response challenge "…", expected "…"`).
 */
const redactQuoted = (text: string): string => text.replace(/"[^"]*"/g, '"[redacted]"');

const clean = (text: string): string => scrub(redactQuoted(text));

/**
 * The answer (429) when an address asked for too many login codes. The browser client tells the
 * two apart by `code`; a 429 without one of these codes is Better Auth's limit per IP address.
 */
export const LOGIN_CODE_LIMIT_ERRORS: Record<LoginCodeLimit, { code: string; message: string }> = {
  quarterHour: {
    code: "TOO_MANY_LOGIN_CODES",
    message: "Too many login codes requested for this address in 15 minutes",
  },
  day: {
    code: "TOO_MANY_LOGIN_CODES_TODAY",
    message: "Too many login codes requested for this address in 24 hours",
  },
};

/**
 * Passes Better Auth's log lines to our logger. Its `info` lines are hints for developers, so
 * they go to `debug`. Arguments are reduced to error names and messages: a database error can
 * carry the row (with an email address) in its details. Quoted values are redacted from the
 * message and the error messages, then addresses are scrubbed.
 */
export function forwardLog(log: FastifyBaseLogger) {
  return (level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) => {
    const errors = args
      .filter((arg): arg is Error => arg instanceof Error)
      .map((error) => ({ type: error.name, message: clean(error.message) }));
    const target = level === "info" ? "debug" : level;
    log[target](
      { errors: errors.length > 0 ? errors : undefined },
      `Better Auth: ${clean(message)}`,
    );
  };
}

/**
 * Better Auth with the email OTP plugin: one flow for signing up and logging in with a code
 * from the mail. The settings and why are in the design ("Login").
 */
export function createAuth({ env, db, mailer, log }: AuthDeps) {
  const limitsOn = env.LOGIN_RATE_LIMITS === "on";
  return betterAuth({
    appName: "PadVinder",
    baseURL: env.PUBLIC_ORIGIN,
    basePath: "/api/auth",
    secret: env.AUTH_SECRET,
    trustedOrigins: env.ALLOWED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        rateLimit: rateLimits,
        passkey: passkeys,
      },
    }),
    user: {
      additionalFields: {
        // Ours. Set through our own profile endpoint, never through Better Auth's client.
        phone: { type: "string", required: false, input: false },
        isPlatformAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
        deletedAt: { type: "date", required: false, input: false },
        lastLoginAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      expiresIn: 180 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
      additionalFields: {
        // Ours: when a passkey last confirmed this session. Read with the session, never set by a client.
        passkeyVerifiedAt: { type: "date", required: false, input: false },
      },
    },
    // Per IP address, counted in `rate_limits`. Explicitly off otherwise: Better Auth's default is
    // "on when NODE_ENV is production", in memory. The custom rules replace Better Auth's own,
    // stricter defaults for these paths (3 per minute). Sign-out needs no limit; every other path
    // is not mounted (`authRoutes`), so Better Auth's global default never applies.
    rateLimit: limitsOn
      ? {
          enabled: true,
          storage: "database",
          customRules: {
            "/email-otp/send-verification-otp": IP_LIMITS.sendCode,
            "/sign-in/email-otp": IP_LIMITS.checkCode,
            "/sign-out": false,
            "/passkey/generate-register-options": IP_LIMITS.passkeyOptions,
            "/passkey/generate-authenticate-options": IP_LIMITS.passkeyOptions,
            "/passkey/verify-registration": IP_LIMITS.passkeyVerify,
            "/passkey/verify-authentication": IP_LIMITS.passkeyVerify,
          },
        }
      : { enabled: false },
    advanced: {
      cookiePrefix: "padvinder",
      useSecureCookies: env.PUBLIC_ORIGIN.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      // Better Auth skips its own origin check when NODE_ENV is "test"; tests must see production.
      disableOriginCheck: false,
      database: { generateId: "uuid" },
      // The client IP for the limiter comes from Better Auth's default header, X-Forwarded-For,
      // used only when it holds exactly one address. Which header Alwaysdata's proxy sets, and
      // whether it overwrites or appends, is checked on staging before the limits are trusted (the
      // design, "Checks on real phones and on Alwaysdata"). Without a usable address, Better Auth
      // falls back to one bucket per path shared by every client.
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body: unknown = ctx.body;
        if (body === null || typeof body !== "object") return;
        // Only login codes. Other kinds (password reset, email verification) would store codes
        // for flows we do not offer.
        if (
          ctx.path === "/email-otp/send-verification-otp" &&
          (!("type" in body) || body.type !== "sign-in")
        ) {
          throw APIError.from("BAD_REQUEST", {
            code: "INVALID_OTP_TYPE",
            message: "Only sign-in codes can be requested",
          });
        }
        // The address is trimmed and lowercased before Better Auth looks at it.
        if (!("email" in body) || typeof body.email !== "string") return;
        const email = normalizeEmail(body.email);
        if (ctx.path === "/email-otp/send-verification-otp") {
          // Better Auth accepts an address of any length; ours stops at 254 characters. Refused
          // with Better Auth's own answer for a malformed address, and before it is counted.
          if (!isValidLoginAddress(email)) {
            throw APIError.from("BAD_REQUEST", { code: "INVALID_EMAIL", message: "Invalid email" });
          }
          // Per address, which Better Auth does not offer. Here and not in `sendVerificationOTP`:
          // Better Auth swallows what that throws and answers 200. Refused before a code is made.
          // The codes tell the app how long to wait (`LOGIN_CODE_LIMIT_ERRORS`).
          const limit = limitsOn ? await checkLoginCodeRequest(db, email, new Date()) : "ok";
          if (limit !== "ok") {
            throw APIError.from("TOO_MANY_REQUESTS", LOGIN_CODE_LIMIT_ERRORS[limit]);
          }
        }
        return { context: { body: { ...body, email } } };
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Whatever the sign-in body says, a new account starts without a name or picture (the
          // app asks for the name through our own profile endpoint), and the stored address is
          // normalized as a second guard.
          before: async (user) => ({
            data: { ...user, email: normalizeEmail(user.email), name: "", image: null },
          }),
        },
      },
      session: {
        create: {
          // Better Auth keeps the IP address and browser of every session for its whole life
          // (180 days). We collect no more personal data than we need, so neither is stored. The
          // columns stay, because Better Auth expects them. A session made by a passkey (a login,
          // a confirmation, or adding one) is confirmed from now; any other is not.
          before: async (session, context) => ({
            data: {
              ...session,
              ipAddress: null,
              userAgent: null,
              ...(context?.path !== undefined &&
                PASSKEY_SESSION_PATHS.has(context.path) && { passkeyVerifiedAt: new Date() }),
            },
          }),
          // A session is made only by a login; a renewal updates the row (it does not come
          // through here). So this is the moment of a login.
          after: async (session) => {
            await db
              .update(users)
              .set({ lastLoginAt: new Date() })
              .where(eq(users.id, session.userId));
          },
        },
      },
    },
    logger: { level: env.LOG_LEVEL, log: forwardLog(log) },
    onAPIError: {
      // Rethrow instead of logging: Better Auth would log a refusal through the console, and
      // better-call writes an unexpected error to the console itself, both past our logger and
      // its scrubbing. A refusal still gets Better Auth's answer; an unexpected error reaches
      // `authRoutes`, which logs it through `forwardLog`.
      throw: true,
    },
    telemetry: { enabled: false },
    plugins: [
      passkey({
        rpID: new URL(env.PUBLIC_ORIGIN).hostname,
        rpName: "PadVinder",
        origin: env.ALLOWED_ORIGINS,
        // Always a fingerprint, face or PIN; discoverable, so login needs no address.
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        authentication: {
          // After the signature check, before the session is made. Better Auth never compares the
          // passkey's account with the session's; a confirmation with someone else's passkey (two
          // admins on one laptop) is refused, and the old session stays. Without a session (the
          // login screen) any account's passkey logs in.
          async afterVerification({ ctx, clientData }) {
            const session = await getSessionFromCtx(ctx, { disableRefresh: true });
            if (!session) return;
            const [row] = await db
              .select({ userId: passkeys.userId })
              .from(passkeys)
              .where(eq(passkeys.credentialID, clientData.id));
            if (row?.userId !== session.user.id) {
              throw APIError.from("FORBIDDEN", {
                code: "PASSKEY_OF_OTHER_ACCOUNT",
                message: "This passkey belongs to another account",
              });
            }
          },
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 30 * 60,
        allowedAttempts: 5,
        // The same code again, so whichever mail the user opens works. That needs a readable code.
        resendStrategy: "reuse",
        storeOTP: "encrypted",
        disableSignUp: false,
        // Not awaited: the answer must not wait for (or reveal anything through) the mail server.
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "sign-in") return; // Refused before it gets here (hooks.before).
          // The name is looked up first, so the mail greets by name; a new address gets "Hallo,".
          // A failed lookup still sends the mail, with no name.
          findUserNameByEmail(db, email)
            .catch(() => null)
            .then((name) =>
              mailer.send(buildLoginCodeMail({ to: email, code: otp, recipientName: name ?? "" })),
            )
            .catch((error: unknown) => {
              log.error(
                { mailError: describeMailError(error) },
                "Sending the login code mail failed",
              );
            });
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
