import { Writable } from "node:stream";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantPlatformAdmin,
  sessions,
  users,
  verifications,
} from "@padvinder/db";
import { createTestDatabase } from "@padvinder/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildApp } from "../app";
import { createMemoryMailer } from "../mail/mailer";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";
import {
  codeFor,
  cookieHeader,
  createTestApp,
  loginAs,
  requestCode,
  signIn,
  type TestApp,
} from "../testing/login";

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx?.close();
});

const setCookies = (res: { headers: Record<string, unknown> }): string[] =>
  [res.headers["set-cookie"] ?? []].flat() as string[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DAY_MS = 24 * 60 * 60 * 1000;

test("a new address gets a code and becomes an account", async () => {
  expect((await requestCode(ctx, "noor@example.test")).statusCode).toBe(200);
  expect(ctx.mailer.sent).toHaveLength(1);
  const res = await signIn(ctx, "noor@example.test", codeFor(ctx, "noor@example.test"));
  expect(res.statusCode).toBe(200);
  const rows = await ctx.t.db.select().from(users);
  expect(rows).toMatchObject([{ email: "noor@example.test", name: "" }]);
  expect(rows[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("signing in answers the user but not the session token", async () => {
  await requestCode(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: { "x-forwarded-for": "10.0.0.1", "user-agent": "Test/1.0" },
    payload: { email: "noor@example.test", otp: codeFor(ctx, "noor@example.test") },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body).toMatchObject({ user: { email: "noor@example.test" } });
  expect(body).not.toHaveProperty("token");
  const [session] = await ctx.t.db.select().from(sessions);
  expect(res.body).not.toContain(session!.token);
  expect(Number(res.headers["content-length"])).toBe(Buffer.byteLength(res.body));
});

test("a session stores no IP address or browser", async () => {
  await requestCode(ctx, "noor@example.test");
  await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: { "x-forwarded-for": "10.0.0.1", "user-agent": "Test/1.0" },
    payload: { email: "noor@example.test", otp: codeFor(ctx, "noor@example.test") },
  });
  expect(await ctx.t.db.select().from(sessions)).toMatchObject([
    { ipAddress: null, userAgent: null },
  ]);
});

test("ids of accounts and sessions are UUIDv7s made by the database", async () => {
  const { userId } = await loginAs(ctx, "noor@example.test");
  const [session] = await ctx.t.db.select().from(sessions);
  for (const id of [userId, session!.id]) {
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test("asking for a code answers the same for a known and an unknown address", async () => {
  await loginAs(ctx, "known@example.test");
  const known = await requestCode(ctx, "known@example.test");
  const unknown = await requestCode(ctx, "unknown@example.test");
  expect(known.statusCode).toBe(200);
  expect(unknown.statusCode).toBe(200);
  expect(unknown.body).toBe(known.body);
});

test("the cookie is HttpOnly, SameSite=Lax and has our prefix", async () => {
  await requestCode(ctx, "noor@example.test");
  const res = await signIn(ctx, "noor@example.test", codeFor(ctx, "noor@example.test"));
  const cookie = setCookies(res).join("\n");
  expect(cookie).toMatch(/padvinder\.session_token=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
  expect(cookie).not.toMatch(/;\s*Secure/i); // plain http origin in tests
});

test("the cookie is Secure on an HTTPS origin", async () => {
  await ctx.close();
  ctx = await createTestApp({
    PUBLIC_ORIGIN: "https://padvinder.test",
    ALLOWED_ORIGINS: ["https://padvinder.test"],
    LOGIN_RATE_LIMITS: "on",
  });
  await requestCode(ctx, "noor@example.test");
  const res = await signIn(ctx, "noor@example.test", codeFor(ctx, "noor@example.test"));
  expect(res.statusCode).toBe(200);
  const cookie = setCookies(res).join("\n");
  expect(cookie).toMatch(/padvinder\.session_token=/);
  expect(cookie).toMatch(/;\s*Secure/i);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Lax/i);
});

test("the session lasts 180 days", async () => {
  await loginAs(ctx, "noor@example.test");
  const [session] = await ctx.t.db.select().from(sessions);
  const expected = Date.now() + 180 * DAY_MS;
  expect(Math.abs(session!.expiresAt.getTime() - expected)).toBeLessThan(60_000);
});

test("a code is valid for half an hour", async () => {
  await requestCode(ctx, "noor@example.test");
  const [verification] = await ctx.t.db.select().from(verifications);
  const expected = Date.now() + 30 * 60 * 1000;
  expect(Math.abs(verification!.expiresAt.getTime() - expected)).toBeLessThan(60_000);
});

test("the code is stored encrypted, not as plain text", async () => {
  await requestCode(ctx, "noor@example.test");
  const code = codeFor(ctx, "noor@example.test");
  const [verification] = await ctx.t.db.select().from(verifications);
  expect(verification!.value).not.toContain(code);
});

test("a wrong code is refused", async () => {
  await requestCode(ctx, "noor@example.test");
  const right = codeFor(ctx, "noor@example.test");
  const wrong = right === "000000" ? "111111" : "000000";
  const res = await signIn(ctx, "noor@example.test", wrong);
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  expect(res.statusCode).toBeLessThan(500);
  expect(res.json()).toMatchObject({ code: "INVALID_OTP" });
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
});

test("after five wrong codes the right one is refused too", async () => {
  await requestCode(ctx, "noor@example.test");
  const right = codeFor(ctx, "noor@example.test");
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) {
    expect((await signIn(ctx, "noor@example.test", wrong)).json()).toMatchObject({
      code: "INVALID_OTP",
    });
  }
  const res = await signIn(ctx, "noor@example.test", right);
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  expect(res.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
});

test("four wrong codes still leave room for the right one", async () => {
  await requestCode(ctx, "noor@example.test");
  const right = codeFor(ctx, "noor@example.test");
  const wrong = right === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) await signIn(ctx, "noor@example.test", wrong);
  expect((await signIn(ctx, "noor@example.test", right)).statusCode).toBe(200);
});

test("an expired code is refused", async () => {
  await requestCode(ctx, "noor@example.test");
  await ctx.t.db.update(verifications).set({ expiresAt: new Date(Date.now() - 1000) });
  const res = await signIn(ctx, "noor@example.test", codeFor(ctx, "noor@example.test"));
  expect(res.statusCode).toBeGreaterThanOrEqual(400);
  expect(res.json()).toMatchObject({ code: "OTP_EXPIRED" });
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
});

test("asking again sends the same code", async () => {
  await requestCode(ctx, "a@example.test");
  await requestCode(ctx, "a@example.test");
  const [first, second] = ctx.mailer.sent.map((m) => m.subject.slice(0, 6));
  expect(second).toBe(first);
  expect((await signIn(ctx, "a@example.test", first!)).statusCode).toBe(200);
});

test("a code works once", async () => {
  await requestCode(ctx, "noor@example.test");
  const code = codeFor(ctx, "noor@example.test");
  expect((await signIn(ctx, "noor@example.test", code)).statusCode).toBe(200);
  const again = await signIn(ctx, "noor@example.test", code);
  expect(again.statusCode).toBeGreaterThanOrEqual(400);
  expect(again.statusCode).toBeLessThan(500);
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(1);
});

test("a code is always six digits of text", async () => {
  for (let i = 0; i < 20; i++) await requestCode(ctx, `person${i}@example.test`);
  expect(ctx.mailer.sent).toHaveLength(20);
  for (const mail of ctx.mailer.sent) expect(mail.subject).toMatch(/^\d{6} /);
});

test("sloppy typing reaches the same account", async () => {
  await loginAs(ctx, "noor@example.test");
  expect((await requestCode(ctx, "  Noor@Example.TEST ")).statusCode).toBe(200);
  expect(ctx.mailer.sent.at(-1)!.to).toBe("noor@example.test");
  const res = await signIn(ctx, " Noor@Example.TEST", codeFor(ctx, "noor@example.test"));
  expect(res.statusCode).toBe(200);
  expect(await ctx.t.db.select().from(users)).toHaveLength(1);
});

test("a new account made with sloppy typing is stored trimmed and lowercase", async () => {
  await requestCode(ctx, " Sam@Example.TEST  ");
  const res = await signIn(ctx, "SAM@example.test ", codeFor(ctx, "sam@example.test"));
  expect(res.statusCode).toBe(200);
  expect(await ctx.t.db.select({ email: users.email }).from(users)).toEqual([
    { email: "sam@example.test" },
  ]);
});

test("the client cannot set the phone number", async () => {
  await requestCode(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: {
      email: "noor@example.test",
      otp: codeFor(ctx, "noor@example.test"),
      phone: "0612345678",
    },
  });
  expect(res.statusCode).toBe(400);
  expect(await ctx.t.db.select().from(users)).toHaveLength(0);
});

test("the client cannot make itself a platform admin", async () => {
  await requestCode(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: {
      email: "noor@example.test",
      otp: codeFor(ctx, "noor@example.test"),
      isPlatformAdmin: true,
    },
  });
  // Whether Better Auth refuses or ignores the field, the account is not an admin.
  expect([200, 400]).toContain(res.statusCode);
  if (res.statusCode === 400) {
    await signIn(ctx, "noor@example.test", codeFor(ctx, "noor@example.test"));
  }
  expect(await ctx.t.db.select({ admin: users.isPlatformAdmin }).from(users)).toEqual([
    { admin: false },
  ]);
});

test("the client cannot set deletedAt at sign-in", async () => {
  await requestCode(ctx, "gone@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: {
      email: "gone@example.test",
      otp: codeFor(ctx, "gone@example.test"),
      deletedAt: "2027-01-01T00:00:00Z",
    },
  });
  // Better Auth refuses the field and uses up the code; the account is not marked as deleted.
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "FIELD_NOT_ALLOWED" });
  await requestCode(ctx, "gone@example.test");
  expect(
    (await signIn(ctx, "gone@example.test", codeFor(ctx, "gone@example.test"))).statusCode,
  ).toBe(200);
  expect(await ctx.t.db.select({ deletedAt: users.deletedAt }).from(users)).toEqual([
    { deletedAt: null },
  ]);
});

test("a name and picture sent with the first sign-in are ignored", async () => {
  await requestCode(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: {
      email: "noor@example.test",
      otp: codeFor(ctx, "noor@example.test"),
      name: "X",
      image: "https://evil.example/x.png",
    },
  });
  expect(res.statusCode).toBe(200);
  expect(await ctx.t.db.select({ name: users.name, image: users.image }).from(users)).toEqual([
    { name: "", image: null },
  ]);
});

test.each(["forget-password", "email-verification", "change-email", undefined])(
  "asking for a code of type %s is refused",
  async (type) => {
    await loginAs(ctx, "noor@example.test");
    const sentBefore = ctx.mailer.sent.length;
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/email-otp/send-verification-otp",
      payload: { email: "noor@example.test", type },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_OTP_TYPE" });
    expect(await ctx.t.db.select().from(verifications)).toHaveLength(0);
    expect(ctx.mailer.sent).toHaveLength(sentBefore);
  },
);

test.each([
  ["POST", "/api/auth/update-user"],
  ["POST", "/api/auth/email-otp/reset-password"],
  ["POST", "/api/auth/email-otp/request-password-reset"],
  ["POST", "/api/auth/forget-password/email-otp"],
  ["POST", "/api/auth/email-otp/verify-email"],
  ["POST", "/api/auth/email-otp/check-verification-otp"],
  ["GET", "/api/auth/list-sessions"],
  ["POST", "/api/auth/revoke-sessions"],
  ["GET", "/api/auth/get-session"],
  ["POST", "/api/auth/sign-in/email-otp/"],
] as const)("Better Auth's %s %s is not mounted", async (method, url) => {
  const { headers } = await loginAs(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method,
    url,
    headers: { ...headers, origin: testEnv.PUBLIC_ORIGIN },
    ...(method === "POST" && { payload: { email: "noor@example.test", name: "X" } }),
  });
  expect(res.statusCode).toBe(404);
  expect(res.json()).toMatchObject({ code: "not_found" });
});

test("a failing mailer does not fail the request", async () => {
  ctx.mailer.failWith(new Error("smtp down"));
  expect((await requestCode(ctx, "a@example.test")).statusCode).toBe(200);
});

test("the code never appears in the log, and Better Auth logs only through ours", async () => {
  await ctx.close();
  // Better Auth's own logger writes to the console; everything must go through our logger.
  const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  const lines: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const t = await createTestDatabase();
  const mailer = createMemoryMailer();
  const app = await buildApp({
    env: { ...testEnv, LOG_LEVEL: "debug" },
    db: t.db,
    notifications: createNoopNotificationHub(),
    mailer,
    logger: true,
    logStream,
  });
  ctx = {
    app,
    mailer,
    t,
    async close() {
      await app.close();
      await t.drop();
    },
  };
  await requestCode(ctx, "noor@example.test");
  const code = codeFor(ctx, "noor@example.test");
  await signIn(ctx, "noor@example.test", code === "000000" ? "111111" : "000000");
  await signIn(ctx, "noor@example.test", code);
  // A failing mail is logged too, without the code or the address.
  mailer.failWith(new Error(`could not send ${code} to noor@example.test`));
  await requestCode(ctx, "noor@example.test");
  // The failed mail is logged once its promise settles, after the response.
  await expect.poll(() => lines.join("")).toContain("login code mail");
  // A refusal from a Better Auth middleware (no Origin with a cookie), and an unexpected error
  // (a stored code that cannot be decrypted).
  const signedIn = await signIn(ctx, "sam@example.test", "000000");
  expect(signedIn.statusCode).toBe(400);
  expect(
    (
      await ctx.app.inject({
        method: "POST",
        url: "/api/auth/sign-out",
        headers: { cookie: "padvinder.session_token=x" },
      })
    ).statusCode,
  ).toBe(403);
  await requestCode(ctx, "sam@example.test");
  await ctx.t.db.update(verifications).set({ value: "broken:0" });
  const broken = await signIn(ctx, "sam@example.test", "123456");
  expect(broken.statusCode).toBe(500);
  expect(broken.json()).toMatchObject({ code: "internal_error" });

  const log = lines.join("");
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  expect(log).toContain("Better Auth: Unexpected error");
  expect(log).not.toContain(code);
  expect(log).not.toContain("noor@example.test");
});

test("a POST from a foreign Origin is refused", async () => {
  const res = await requestCode(ctx, "noor@example.test", { origin: "https://evil.example" });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: "origin_not_allowed" });
  expect(ctx.mailer.sent).toHaveLength(0);
});

test("a POST with a session cookie but without an Origin is refused", async () => {
  // Our Origin hook lets a request without Origin pass (curl); Better Auth's own check does not
  // when a cookie comes along, also when NODE_ENV is "test".
  const { headers } = await loginAs(ctx, "noor@example.test");
  const res = await ctx.app.inject({ method: "POST", url: "/api/auth/sign-out", headers });
  expect(res.statusCode).toBe(403);
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(1);
});

test("signing out ends the session", async () => {
  const { headers } = await loginAs(ctx, "noor@example.test");
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(1);
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: { ...headers, origin: testEnv.PUBLIC_ORIGIN },
  });
  expect(res.statusCode).toBe(200);
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
  // Sign-out clears several cookies; every Set-Cookie header must reach the client.
  const cookies = setCookies(res);
  expect(cookies.length).toBeGreaterThan(1);
  expect(cookies.find((c) => c.startsWith("padvinder.session_token="))).toMatch(/Max-Age=0/i);
  expect(cookieHeader(res)).toBe("");
});

test("signing out as the browser client does (JSON content type, body {}) works", async () => {
  // The Better Auth browser client's signOut() sends POST with `content-type: application/json`
  // and the body `{}`; Fastify must not refuse that before Better Auth sees it.
  const { headers } = await loginAs(ctx, "noor@example.test");
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-out",
    headers: { ...headers, origin: testEnv.PUBLIC_ORIGIN, "content-type": "application/json" },
    payload: "{}",
  });
  expect(res.statusCode).toBe(200);
  expect(await ctx.t.db.select().from(sessions)).toHaveLength(0);
});

test("a session cookie gives access to the session", async () => {
  const { userId, headers } = await loginAs(ctx, "noor@example.test", { name: "Noor" });
  const session = await ctx.app.auth.api.getSession({ headers: new Headers(headers) });
  expect(session).toMatchObject({ user: { id: userId, name: "Noor" } });
});

test("the auth routes are not in the OpenAPI description", async () => {
  await ctx.app.ready();
  const paths = Object.keys((ctx.app.swagger() as { paths?: object }).paths ?? {});
  expect(paths.filter((path) => path.startsWith("/api/auth"))).toEqual([]);
});

test("every Better Auth table makes its ids with uuidv7()", async () => {
  // Better Auth leaves the id to the database (generateId "uuid" on PostgreSQL).
  const result = await ctx.t.db.execute<{ column_default: string }>(
    sql`select column_default from information_schema.columns
        where table_name in ('users', 'sessions', 'accounts', 'verifications', 'rate_limits')
          and column_name = 'id'`,
  );
  expect(result.rows.map((row) => row.column_default)).toEqual(
    Array.from({ length: 5 }, () => "uuidv7()"),
  );
});

test("an account made by a grant is the one that logs in with that address", async () => {
  const granted = await grantPlatformAdmin(
    ctx.t.db,
    { email: "Eerste@Example.test" },
    { kind: "system" },
  );
  const { userId } = await loginAs(ctx, "eerste@example.test");
  expect(userId).toBe(granted.userId);
  expect(await ctx.t.db.select().from(users)).toMatchObject([
    { id: granted.userId, isPlatformAdmin: true },
  ]);
});

test("a login sets last_login_at; a second login moves it", async () => {
  const { userId } = await loginAs(ctx, "eerste@example.test");
  const [first] = await ctx.t.db.select().from(users).where(eq(users.id, userId));
  expect(first!.lastLoginAt).toBeInstanceOf(Date);
  await sleep(20);
  await loginAs(ctx, "eerste@example.test");
  const [second] = await ctx.t.db.select().from(users).where(eq(users.id, userId));
  expect(second!.lastLoginAt!.getTime()).toBeGreaterThan(first!.lastLoginAt!.getTime());
});

test("an account made by the admin tool has no last_login_at until its first login", async () => {
  const system = { kind: "system" } as const;
  const org = await createOrganization(
    ctx.t.db,
    { name: "Login Org", adminEmail: "org-admin@example.test" },
    system,
  );
  const wg = await createWorkingGroup(
    ctx.t.db,
    {
      organizationId: org.id,
      name: "Login Groep",
      city: "Enschede",
      coordinatorEmail: "login-coordinator@example.test",
    },
    system,
  );
  const made = await grantCoordinator(
    ctx.t.db,
    { email: "nieuw@example.test", workingGroupId: wg.id },
    system,
  );
  const [before] = await ctx.t.db.select().from(users).where(eq(users.id, made.userId));
  expect(before!.lastLoginAt).toBeNull();
  await loginAs(ctx, "nieuw@example.test");
  const [after] = await ctx.t.db.select().from(users).where(eq(users.id, made.userId));
  expect(after!.lastLoginAt).toBeInstanceOf(Date);
});
