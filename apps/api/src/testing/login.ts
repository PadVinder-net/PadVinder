import { normalizeEmail, updateUserProfile } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../app";
import type { ApiEnv } from "../env";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

export type TestApp = {
  app: FastifyInstance;
  mailer: ReturnType<typeof createMemoryMailer>;
  /** The mail jobs the app queued, in order; the tests read `jobs`. */
  mailQueue: ReturnType<typeof createMemoryMailQueue>;
  t: TestDatabase;
  close(): Promise<void>;
};

/**
 * An app on its own cloned test database, with `testEnv`, and a mailer and a mail queue that keep
 * mails and jobs in memory.
 */
export async function createTestApp(overrides: Partial<ApiEnv> = {}): Promise<TestApp> {
  const t = await createTestDatabase();
  const mailer = createMemoryMailer();
  const mailQueue = createMemoryMailQueue();
  try {
    const app = await buildApp({
      env: { ...testEnv, ...overrides },
      db: t.db,
      notifications: createNoopNotificationHub(),
      mailer,
      queueMail: mailQueue.queueMail,
    });
    return {
      app,
      mailer,
      mailQueue,
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

/** How many login code requests per address were answered 200, so how many mails must arrive. */
const answeredRequests = new WeakMap<object, Map<string, number>>();

export async function requestCode(
  ctx: TestApp,
  email: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/email-otp/send-verification-otp",
    headers,
    payload: { email, type: "sign-in" },
  });
  if (res.statusCode !== 200) return res;
  const address = normalizeEmail(email);
  const counts = answeredRequests.get(ctx) ?? new Map<string, number>();
  answeredRequests.set(ctx, counts);
  const expected = (counts.get(address) ?? 0) + 1;
  counts.set(address, expected);
  // The API sends the mail without the request waiting for it (it looks up the name first), so
  // wait here until every mail for the 200 answers so far has arrived: the tests count mails and
  // read the code right after, also with several requests at once.
  const arrived = () =>
    ctx.mailer.sent.filter((sent) => normalizeEmail(sent.to) === address).length;
  for (let i = 0; arrived() < expected && i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return res;
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
