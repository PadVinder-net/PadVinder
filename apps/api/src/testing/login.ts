import { normalizeEmail, updateUserProfile } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app";
import type { ApiEnv } from "../env";
import { createMemoryMailer } from "../mail/mailer";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

export type TestApp = {
  app: FastifyInstance;
  mailer: ReturnType<typeof createMemoryMailer>;
  t: TestDatabase;
  close(): Promise<void>;
};

/** An app on its own cloned test database, with `testEnv` and a mailer that keeps mails in memory. */
export async function createTestApp(overrides: Partial<ApiEnv> = {}): Promise<TestApp> {
  const t = await createTestDatabase();
  const mailer = createMemoryMailer();
  try {
    const app = await buildApp({
      env: { ...testEnv, ...overrides },
      db: t.db,
      notifications: createNoopNotificationHub(),
      mailer,
    });
    return {
      app,
      mailer,
      t,
      async close() {
        try {
          await app.close();
        } finally {
          await t.drop();
        }
      },
    };
  } catch (error) {
    await t.drop();
    throw error;
  }
}

export function requestCode(
  ctx: TestApp,
  email: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: "POST",
    url: "/api/auth/email-otp/send-verification-otp",
    headers,
    payload: { email, type: "sign-in" },
  });
}

/** The code from the subject of the newest mail to that address. */
export function codeFor(ctx: TestApp, email: string): string {
  const mail = ctx.mailer.sent.findLast(
    (sent) => normalizeEmail(sent.to) === normalizeEmail(email),
  );
  if (!mail) throw new Error(`No mail was sent to ${email}`);
  const code = /^(\d{6}) /.exec(mail.subject)?.[1];
  if (!code) throw new Error(`No code in the subject "${mail.subject}"`);
  return code;
}

export function signIn(ctx: TestApp, email: string, code: string): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: { email, otp: code },
  });
}

/** The `name=value` pairs of the cookies a response sets, for a later `cookie` header. */
export function cookieHeader(res: LightMyRequestResponse): string {
  return res.cookies
    .filter((cookie) => cookie.value !== "" && cookie.maxAge !== 0)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/**
 * Logs in through the real flow (ask for a code, read it from the mail, sign in) and sets the
 * profile. The name defaults to "Test Persoon"; `name: ""` leaves it empty, as for a new account.
 */
export async function loginAs(
  ctx: TestApp,
  email: string,
  profile: { name?: string; phone?: string | null } = {},
): Promise<{ userId: string; headers: { cookie: string } }> {
  const requested = await requestCode(ctx, email);
  if (requested.statusCode !== 200) {
    throw new Error(`Asking for a code failed with ${requested.statusCode}: ${requested.body}`);
  }
  const res = await signIn(ctx, email, codeFor(ctx, email));
  if (res.statusCode !== 200) {
    throw new Error(`Signing in failed with ${res.statusCode}: ${res.body}`);
  }
  const userId = (res.json() as { user: { id: string } }).user.id;
  await updateUserProfile(ctx.t.db, userId, {
    name: profile.name ?? "Test Persoon",
    phone: profile.phone,
  });
  return { userId, headers: { cookie: cookieHeader(res) } };
}
