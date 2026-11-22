import {
  accounts,
  normalizeEmail,
  rateLimits,
  sessions,
  users,
  verifications,
  type Db,
} from "@padvinder/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { FastifyBaseLogger } from "fastify";
import type { ApiEnv } from "../env";
import { buildLoginCodeMail } from "../mail/login-code-mail";
import type { Mailer } from "../mail/mailer";
import { checkLoginCodeRequest, IP_LIMITS, isValidLoginAddress } from "./login-rate-limit";

export type AuthDeps = { env: ApiEnv; db: Db; mailer: Mailer; log: FastifyBaseLogger };

const DAY_SECONDS = 24 * 60 * 60;

// Anything that looks like an email address, to keep addresses out of Better Auth's log lines.
const EMAIL_LIKE = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;
const scrub = (text: string) => text.replace(EMAIL_LIKE, "[email]");

/**
 * Passes Better Auth's log lines to our logger. Its `info` lines are hints for developers, so
 * they go to `debug`. Arguments are reduced to error names and messages: a database error can
 * carry the row (with an email address) in its details.
 */
export function forwardLog(log: FastifyBaseLogger) {
  return (level: "debug" | "info" | "warn" | "error", message: string, ...args: unknown[]) => {
    const errors = args
      .filter((arg): arg is Error => arg instanceof Error)
      .map((error) => ({ type: error.name, message: scrub(error.message) }));
    const target = level === "info" ? "debug" : level;
    log[target](
      { errors: errors.length > 0 ? errors : undefined },
      `Better Auth: ${scrub(message)}`,
    );
  };
}

/** What may be logged about a failed mail: never the address or the code. */
function describeMailError(error: unknown) {
  if (!(error instanceof Error)) return { type: typeof error };
  const { code, responseCode, command } = error as Error & {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  return { type: error.name, code, responseCode, command };
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
      },
    }),
    user: {
      additionalFields: {
        // Ours. Set through our own profile endpoint, never through Better Auth's client.
        phone: { type: "string", required: false, input: false },
        isPlatformAdmin: { type: "boolean", required: false, input: false, defaultValue: false },
      },
    },
    session: {
      expiresIn: 180 * DAY_SECONDS,
      updateAge: DAY_SECONDS,
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
          if (limitsOn && (await checkLoginCodeRequest(db, email, new Date())) === "limited") {
            throw APIError.from("TOO_MANY_REQUESTS", {
              code: "TOO_MANY_REQUESTS",
              message: "Too many login codes requested for this address",
            });
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
          mailer.send(buildLoginCodeMail({ to: email, code: otp })).catch((error: unknown) => {
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
