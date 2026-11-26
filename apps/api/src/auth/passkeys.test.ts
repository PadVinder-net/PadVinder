import { QUERY_ERROR_MESSAGE } from "@padvinder/logging";
import { createTestLogger } from "@padvinder/logging/testing";
import {
  auditLogEntries,
  createOrganization,
  grantPlatformAdmin,
  MAX_PASSKEYS_PER_ACCOUNT,
  passkeys,
  sessions,
} from "@padvinder/db";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createCast, expectStatuses } from "../testing/cast";
import { codeFor, createTestApp, loginAs, requestCode, type TestApp } from "../testing/login";
import {
  addPasskey,
  postAuth,
  sessionTokenOf,
  stampSession,
  usePasskey,
  withCookies,
} from "../testing/passkeys";
import { createSoftAuthenticator } from "../testing/soft-authenticator";
import { testEnv } from "../test-env";
import { IP_LIMITS } from "./login-rate-limit";

let ctx: TestApp;
beforeEach(async () => {
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx?.close();
});

const system = { kind: "system" } as const;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const newAuthenticator = (input: { userVerified?: boolean } = {}) =>
  createSoftAuthenticator({ origin: testEnv.PUBLIC_ORIGIN, ...input });

/** A platform admin, logged in with a code: a session without a passkey. */
async function platformAdmin(email = "hoofd@example.test") {
  await grantPlatformAdmin(ctx.t.db, { email }, system);
  const { userId, headers } = await loginAs(ctx, email);
  return { userId, cookie: headers.cookie };
}

/** An organization admin, logged in with a code. */
async function organizationAdmin(email = "beheerder@example.test") {
  await createOrganization(ctx.t.db, { name: `Organisatie ${email}`, adminEmail: email }, system);
  const { userId, headers } = await loginAs(ctx, email);
  return { userId, cookie: headers.cookie };
}

/** An admin with one passkey; `cookie` is the stamped session the registration made. */
async function adminWithPasskey(email = "hoofd@example.test") {
  const admin = await platformAdmin(email);
  const authenticator = newAuthenticator();
  const added = await addPasskey(ctx, admin.cookie, authenticator);
  expect(added.response.statusCode).toBe(200);
  return { ...admin, cookie: added.cookie, authenticator };
}

const me = (cookie: string | null) =>
  ctx.app.inject({ method: "GET", url: "/api/me", headers: cookie ? { cookie } : {} });

const sessionRow = async (cookie: string | null) => {
  const token = sessionTokenOf(cookie);
  if (!token) return undefined;
  return (await ctx.t.db.select().from(sessions).where(eq(sessions.token, token)))[0];
};

const allSessions = () => ctx.t.db.select().from(sessions);

const passkeyRows = (userId: string) =>
  ctx.t.db.select().from(passkeys).where(eq(passkeys.userId, userId));

const PASSKEY_PATHS = [
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
] as const;

test("an admin adds a first passkey from a code session, and the new session is stamped", async () => {
  const admin = await organizationAdmin();
  expect((await sessionRow(admin.cookie))!.passkeyVerifiedAt).toBeNull();
  const authenticator = newAuthenticator();
  const before = Date.now();
  const { cookie, response } = await addPasskey(ctx, admin.cookie, authenticator);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  const session = await sessionRow(cookie);
  expect(session!.userId).toBe(admin.userId);
  expect(session!.passkeyVerifiedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  expect(await passkeyRows(admin.userId)).toMatchObject([
    { userId: admin.userId, credentialID: authenticator.credentialId },
  ]);
});

test("the registration replaces the session: the old cookie is 401 on /api/me, the new one works", async () => {
  const admin = await platformAdmin();
  const { cookie } = await addPasskey(ctx, admin.cookie, newAuthenticator());
  expect(cookie).not.toBe(admin.cookie);
  expect((await me(admin.cookie)).statusCode).toBe(401);
  const res = await me(cookie);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ user: { id: admin.userId } });
  expect(await allSessions()).toHaveLength(1);
});

test("createSession: false from the client still makes and stamps a new session and deletes the old one", async () => {
  const admin = await platformAdmin();
  const { cookie, response } = await addPasskey(ctx, admin.cookie, newAuthenticator(), {
    createSession: false,
    name: "Mijn sleutel",
  });
  expect(response.statusCode).toBe(200);
  expect(sessionTokenOf(cookie)).not.toBe(sessionTokenOf(admin.cookie));
  expect((await sessionRow(cookie))!.passkeyVerifiedAt).toBeInstanceOf(Date);
  expect((await me(admin.cookie)).statusCode).toBe(401);
  expect(await allSessions()).toHaveLength(1);
  // Only the credential reaches Better Auth: the name is dropped too.
  expect(await passkeyRows(admin.userId)).toMatchObject([{ name: null }]);
});

test("the options are asked for without the client's query or body", async () => {
  const admin = await platformAdmin();
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/passkey/generate-register-options?name=Iemand&authenticatorAttachment=cross-platform",
    headers: { cookie: admin.cookie, origin: testEnv.PUBLIC_ORIGIN },
    payload: { name: "Iemand", authenticatorAttachment: "cross-platform" },
  });
  expect(res.statusCode).toBe(200);
  const options = res.json();
  expect(options.user.name).toBe("hoofd@example.test");
  expect(options.authenticatorSelection).not.toHaveProperty("authenticatorAttachment");
});

test("a second passkey is 403 passkey_required without a recent confirmation, and allowed with one", async () => {
  const admin = await adminWithPasskey();
  await stampSession(ctx, admin.cookie, new Date(Date.now() - 11 * MINUTE_MS));
  const second = newAuthenticator();
  for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration"]) {
    const res = await postAuth(ctx, path, admin.cookie, { response: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "passkey_required" });
  }
  await stampSession(ctx, admin.cookie, new Date());
  const added = await addPasskey(ctx, admin.cookie, second);
  expect(added.response.statusCode).toBe(200);
  expect(await passkeyRows(admin.userId)).toHaveLength(2);
});

test("an eleventh passkey is 409 too_many_passkeys", async () => {
  const admin = await adminWithPasskey();
  await ctx.t.db.insert(passkeys).values(
    Array.from({ length: MAX_PASSKEYS_PER_ACCOUNT - 1 }, (_, i) => ({
      userId: admin.userId,
      publicKey: `key-${i}`,
      credentialID: `credential-${i}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    })),
  );
  await stampSession(ctx, admin.cookie, new Date());
  for (const path of ["/passkey/generate-register-options", "/passkey/verify-registration"]) {
    const res = await postAuth(ctx, path, admin.cookie, { response: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "too_many_passkeys" });
  }
  expect(await passkeyRows(admin.userId)).toHaveLength(MAX_PASSKEYS_PER_ACCOUNT);
});

test("a volunteer, a coordinator and an applicant get 403 not_allowed on both registration routes", async () => {
  const cast = await createCast(ctx);
  const send = (path: string) => (headers: Record<string, string>) =>
    postAuth(ctx, path, headers.cookie ?? null, { response: {} });
  const refused = {
    coordinator: 403,
    volunteer: 403,
    volunteerOtherGroup: 403,
    coordinatorOtherOrganization: 403,
    applicant: 403,
    anonymous: 401,
  };
  await expectStatuses(
    cast,
    {
      ...refused,
      platformAdmin: 200,
      organizationAdmin: 200,
      organizationAdminOtherOrganization: 200,
    },
    send("/passkey/generate-register-options"),
  );
  // The admins pass our checks; Better Auth then finds no challenge for this junk body.
  await expectStatuses(
    cast,
    {
      ...refused,
      platformAdmin: 400,
      organizationAdmin: 400,
      organizationAdminOtherOrganization: 400,
    },
    send("/passkey/verify-registration"),
  );
  const res = await send("/passkey/generate-register-options")(cast.members.volunteer.headers);
  expect(res.json()).toMatchObject({ code: "not_allowed" });
  expect(
    (await send("/passkey/verify-registration")(cast.members.applicant.headers)).json(),
  ).toMatchObject({ code: "not_allowed" });
  expect((await send("/passkey/verify-registration")({})).json()).toMatchObject({
    code: "not_logged_in",
  });
});

test("a code session older than a day gets SESSION_NOT_FRESH on a first passkey", async () => {
  const admin = await platformAdmin();
  await ctx.t.db
    .update(sessions)
    .set({ createdAt: new Date(Date.now() - 25 * HOUR_MS) })
    .where(eq(sessions.userId, admin.userId));
  const { response } = await addPasskey(ctx, admin.cookie, newAuthenticator());
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
  expect(await passkeyRows(admin.userId)).toHaveLength(0);
});

test("logging in with a passkey without a cookie makes a stamped session for the passkey's account", async () => {
  const admin = await adminWithPasskey();
  const before = await allSessions();
  const { cookie, response } = await usePasskey(ctx, null, admin.authenticator);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ ok: true });
  expect((await me(cookie)).json()).toMatchObject({ user: { id: admin.userId } });
  expect((await sessionRow(cookie))!.passkeyVerifiedAt).toBeInstanceOf(Date);
  expect(await allSessions()).toHaveLength(before.length + 1);
  // The other session of the account (the registration's) is not touched by a login.
  expect((await me(admin.cookie)).statusCode).toBe(200);
});

test("a confirmation replaces the session and stamps the new one; the old cookie is 401", async () => {
  const admin = await adminWithPasskey();
  await stampSession(ctx, admin.cookie, null);
  const { cookie, response } = await usePasskey(ctx, admin.cookie, admin.authenticator);
  expect(response.statusCode).toBe(200);
  expect(sessionTokenOf(cookie)).not.toBe(sessionTokenOf(admin.cookie));
  expect((await sessionRow(cookie))!.passkeyVerifiedAt).toBeInstanceOf(Date);
  expect((await me(admin.cookie)).statusCode).toBe(401);
  expect((await me(cookie)).json()).toMatchObject({ user: { id: admin.userId } });
  expect(await allSessions()).toHaveLength(1);
});

test("another account's passkey in a confirmation is 403 PASSKEY_OF_OTHER_ACCOUNT; no session is made, the old one still works", async () => {
  const first = await adminWithPasskey("eerste@example.test");
  const second = await adminWithPasskey("tweede@example.test");
  const before = await allSessions();
  const { cookie, response } = await usePasskey(ctx, first.cookie, second.authenticator);
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: "PASSKEY_OF_OTHER_ACCOUNT" });
  expect(sessionTokenOf(cookie)).toBe(sessionTokenOf(first.cookie));
  expect(await allSessions()).toEqual(before);
  expect((await me(first.cookie)).json()).toMatchObject({ user: { id: first.userId } });
  // On the login screen, without a session, the same passkey logs its own account in.
  const login = await usePasskey(ctx, null, second.authenticator);
  expect(login.response.statusCode).toBe(200);
  expect((await me(login.cookie)).json()).toMatchObject({ user: { id: second.userId } });
});

test("when the session cannot be read during a confirmation, another account's passkey is refused, not logged in", async () => {
  const first = await adminWithPasskey("eerste@example.test");
  const second = await adminWithPasskey("tweede@example.test");
  const options = await postAuth(ctx, "/passkey/generate-authenticate-options", first.cookie);
  const jar = withCookies(first.cookie, options);
  const { internalAdapter } = await ctx.app.auth.$context;
  const findSession = internalAdapter.findSession.bind(internalAdapter);
  let reads = 0;
  // The route's own read of the previous session works; every read after it (the check inside
  // Better Auth) fails, as a database error would.
  const spy = vi.spyOn(internalAdapter, "findSession").mockImplementation(async (token) => {
    reads += 1;
    if (reads === 1) return findSession(token);
    throw new Error("connection terminated");
  });
  const before = await allSessions();
  const res = await postAuth(ctx, "/passkey/verify-authentication", jar, {
    response: second.authenticator.authenticate(options.json()),
  });
  spy.mockRestore();
  expect(reads).toBeGreaterThan(1);
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ code: "AUTHENTICATION_FAILED" });
  expect(await allSessions()).toEqual(before);
  expect((await me(first.cookie)).json()).toMatchObject({ user: { id: first.userId } });
});

test("a passkey that was removed answers PASSKEY_NOT_FOUND and makes no session", async () => {
  const admin = await adminWithPasskey();
  await ctx.t.db.delete(passkeys).where(eq(passkeys.userId, admin.userId));
  const before = await allSessions();
  const { response } = await usePasskey(ctx, null, admin.authenticator);
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({ code: "PASSKEY_NOT_FOUND" });
  expect(await allSessions()).toEqual(before);
});

test("an assertion without user verification is refused", async () => {
  const admin = await adminWithPasskey();
  admin.authenticator.userVerified = false;
  const before = await allSessions();
  const { response } = await usePasskey(ctx, null, admin.authenticator);
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: "AUTHENTICATION_FAILED" });
  expect(await allSessions()).toEqual(before);
});

test("a registration without user verification is refused", async () => {
  const admin = await platformAdmin();
  const { response } = await addPasskey(
    ctx,
    admin.cookie,
    newAuthenticator({ userVerified: false }),
  );
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: "FAILED_TO_VERIFY_REGISTRATION" });
  expect(await passkeyRows(admin.userId)).toHaveLength(0);
  expect((await me(admin.cookie)).statusCode).toBe(200);
});

test("a code login is not stamped", async () => {
  await adminWithPasskey();
  const { headers } = await loginAs(ctx, "hoofd@example.test");
  expect((await sessionRow(headers.cookie))!.passkeyVerifiedAt).toBeNull();
});

test("a client cannot set passkeyVerifiedAt", async () => {
  const at = "2027-01-01T00:00:00.000Z";
  // Not with a code login.
  await requestCode(ctx, "hoofd@example.test");
  const signedIn = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    payload: {
      email: "hoofd@example.test",
      otp: codeFor(ctx, "hoofd@example.test"),
      passkeyVerifiedAt: at,
    },
  });
  expect([200, 400]).toContain(signedIn.statusCode);
  for (const session of await allSessions()) expect(session.passkeyVerifiedAt).toBeNull();
  // Not with a passkey: the moment is the server's, never the one in the body.
  const admin = await platformAdmin();
  const authenticator = newAuthenticator();
  const added = await addPasskey(ctx, admin.cookie, authenticator, { passkeyVerifiedAt: at });
  expect(added.response.statusCode).toBe(200);
  const options = await postAuth(ctx, "/passkey/generate-authenticate-options", null);
  const used = await postAuth(ctx, "/passkey/verify-authentication", withCookies(null, options), {
    response: authenticator.authenticate(options.json()),
    passkeyVerifiedAt: at,
  });
  expect(used.statusCode).toBe(200);
  for (const session of await allSessions()) {
    expect(session.passkeyVerifiedAt?.toISOString()).not.toBe(at);
  }
});

test("the verify answers are { ok: true }: no token, no publicKey, no credentialID, no session in the raw body", async () => {
  const admin = await platformAdmin();
  const authenticator = newAuthenticator();
  const added = await addPasskey(ctx, admin.cookie, authenticator);
  const used = await usePasskey(ctx, null, authenticator);
  const [row] = await passkeyRows(admin.userId);
  const tokens = (await allSessions()).map((session) => session.token);
  expect(tokens).toHaveLength(2);
  for (const { response } of [added, used]) {
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    expect(Number(response.headers["content-length"])).toBe(Buffer.byteLength(response.body));
    for (const secret of [...tokens, row!.publicKey, row!.credentialID, row!.id]) {
      expect(response.body).not.toContain(secret);
    }
  }
});

test("the options hold no other account's credential ID and no public key", async () => {
  const first = await adminWithPasskey("eerste@example.test");
  const second = await adminWithPasskey("tweede@example.test");
  const [own] = await passkeyRows(first.userId);
  const [other] = await passkeyRows(second.userId);
  const tokens = (await allSessions()).map((session) => session.token);
  const registerOptions = await postAuth(ctx, "/passkey/generate-register-options", first.cookie);
  const authenticateOptions = await postAuth(
    ctx,
    "/passkey/generate-authenticate-options",
    first.cookie,
  );
  const anonymousOptions = await postAuth(ctx, "/passkey/generate-authenticate-options", null);
  for (const res of [registerOptions, authenticateOptions, anonymousOptions]) {
    expect(res.statusCode).toBe(200);
    for (const secret of [other!.credentialID, own!.publicKey, other!.publicKey, ...tokens]) {
      expect(res.body).not.toContain(secret);
    }
  }
  // The browser needs the account's own: to avoid a double registration, and to choose.
  expect(registerOptions.json().excludeCredentials).toEqual([
    expect.objectContaining({ id: own!.credentialID }),
  ]);
  expect(authenticateOptions.json().allowCredentials).toEqual([
    expect.objectContaining({ id: own!.credentialID }),
  ]);
  expect(anonymousOptions.body).not.toContain(own!.credentialID);
  expect(registerOptions.json()).toMatchObject({
    rp: { id: "localhost", name: "PadVinder" },
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    attestation: "none",
  });
  expect(anonymousOptions.json()).toMatchObject({
    rpId: "localhost",
    userVerification: "required",
  });
});

test("GET on each of the four paths is 404; a POST with a foreign Origin is refused", async () => {
  const admin = await platformAdmin();
  for (const path of PASSKEY_PATHS) {
    const get = await ctx.app.inject({
      method: "GET",
      url: `/api/auth${path}`,
      headers: { cookie: admin.cookie },
    });
    expect(get.statusCode).toBe(404);
    expect(get.json()).toMatchObject({ code: "not_found" });
    const foreign = await ctx.app.inject({
      method: "POST",
      url: `/api/auth${path}`,
      headers: { cookie: admin.cookie, origin: "https://evil.example" },
      payload: {},
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ code: "origin_not_allowed" });
  }
  expect(await ctx.t.db.select().from(passkeys)).toHaveLength(0);
});

test("list-user-passkeys, delete-passkey and update-passkey are 404", async () => {
  const admin = await adminWithPasskey();
  const [row] = await passkeyRows(admin.userId);
  for (const [method, path] of [
    ["GET", "/passkey/list-user-passkeys"],
    ["POST", "/passkey/delete-passkey"],
    ["POST", "/passkey/update-passkey"],
  ] as const) {
    const res = await ctx.app.inject({
      method,
      url: `/api/auth${path}`,
      headers: { cookie: admin.cookie, origin: testEnv.PUBLIC_ORIGIN },
      ...(method === "POST" && { payload: { id: row!.id, name: "X" } }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  }
  expect(await passkeyRows(admin.userId)).toMatchObject([{ id: row!.id, name: null }]);
});

test("adding writes passkey.added and queues passkey-added", async () => {
  const admin = await adminWithPasskey();
  const [row] = await passkeyRows(admin.userId);
  expect(
    await ctx.t.db
      .select()
      .from(auditLogEntries)
      .where(eq(auditLogEntries.action, "passkey.added")),
  ).toMatchObject([
    {
      actorKind: "user",
      actorUserId: admin.userId,
      organizationId: null,
      subjectType: "user",
      subjectId: admin.userId,
    },
  ]);
  expect(ctx.mailQueue.jobs).toEqual([
    { kind: "passkey-added", userId: admin.userId, passkeyId: row!.id },
  ]);
});

test("a confirmation or a login writes no audit entry and queues no mail", async () => {
  const admin = await adminWithPasskey();
  const entries = (await ctx.t.db.select().from(auditLogEntries)).length;
  await usePasskey(ctx, admin.cookie, admin.authenticator);
  await usePasskey(ctx, null, admin.authenticator);
  expect(await ctx.t.db.select().from(auditLogEntries)).toHaveLength(entries);
  expect(ctx.mailQueue.jobs).toHaveLength(1);
});

test("with LOGIN_RATE_LIMITS on, the 61st options request in 5 minutes from one address is 429", async () => {
  await ctx.close();
  ctx = await createTestApp({ LOGIN_RATE_LIMITS: "on" });
  expect(IP_LIMITS).toMatchObject({
    passkeyOptions: { window: 300, max: 60 },
    passkeyVerify: { window: 300, max: 60 },
  });
  const options = (address: string) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/auth/passkey/generate-authenticate-options",
      headers: { origin: testEnv.PUBLIC_ORIGIN, "x-forwarded-for": address },
      payload: {},
    });
  for (let i = 0; i < 60; i++) expect((await options("10.0.0.9")).statusCode).toBe(200);
  const refused = await options("10.0.0.9");
  expect(refused.statusCode).toBe(429);
  expect((await options("10.0.0.10")).statusCode).toBe(200);
}, 60_000);

test("with LOGIN_RATE_LIMITS on, the 61st verify request in 5 minutes from one address is 429", async () => {
  await ctx.close();
  ctx = await createTestApp({ LOGIN_RATE_LIMITS: "on" });
  const verify = (address: string) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/auth/passkey/verify-authentication",
      headers: { origin: testEnv.PUBLIC_ORIGIN, "x-forwarded-for": address },
      payload: { response: {} },
    });
  // Without a challenge each is refused by Better Auth, and counted all the same.
  for (let i = 0; i < 60; i++) {
    const res = await verify("10.0.0.9");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  }
  expect((await verify("10.0.0.9")).statusCode).toBe(429);
  expect((await verify("10.0.0.10")).statusCode).toBe(400);
}, 60_000);

test("no log line of a failed verification holds the challenge or the credential ID", async () => {
  await ctx.close();
  const logs = createTestLogger("debug");
  ctx = await createTestApp({ LOG_LEVEL: "debug" }, { logger: logs.logger });
  const admin = await platformAdmin();
  const authenticator = newAuthenticator();
  const wrongChallenge = isoBase64URL.fromUTF8String("not-the-challenge-1234567890");

  // A registration with the wrong challenge.
  const registerOptions = await postAuth(ctx, "/passkey/generate-register-options", admin.cookie);
  const refusedRegistration = await postAuth(
    ctx,
    "/passkey/verify-registration",
    withCookies(admin.cookie, registerOptions),
    { response: authenticator.register({ ...registerOptions.json(), challenge: wrongChallenge }) },
  );
  expect(refusedRegistration.statusCode).toBe(400);

  // An assertion with the wrong challenge, after a good registration.
  const added = await addPasskey(ctx, admin.cookie, authenticator);
  expect(added.response.statusCode).toBe(200);
  const authenticateOptions = await postAuth(ctx, "/passkey/generate-authenticate-options", null);
  const refused = await postAuth(
    ctx,
    "/passkey/verify-authentication",
    withCookies(null, authenticateOptions),
    {
      response: authenticator.authenticate({
        ...authenticateOptions.json(),
        challenge: wrongChallenge,
      }),
    },
  );
  expect(refused.statusCode).toBe(400);

  const log = logs.text();
  expect(log).toContain("Failed to verify registration");
  expect(log).toContain("Failed to verify authentication");
  // In a JSON line the quotes are escaped.
  expect(log).toContain('response challenge \\"[redacted]\\""');
  for (const secret of [
    wrongChallenge,
    registerOptions.json().challenge,
    authenticateOptions.json().challenge,
    authenticator.credentialId,
    testEnv.PUBLIC_ORIGIN,
  ]) {
    expect(log).not.toContain(secret);
  }
});

test("a database failure during a passkey login logs no credential ID, query or parameter", async () => {
  await ctx.close();
  const logs = createTestLogger("debug");
  ctx = await createTestApp({ LOG_LEVEL: "debug" }, { logger: logs.logger });
  const { authenticator } = await adminWithPasskey();
  const options = await postAuth(ctx, "/passkey/generate-authenticate-options", null);
  // Better Auth's look-up of the passkey by its credential ID now fails in the database.
  await ctx.t.pool.query("alter table passkeys rename to passkeys_gone");
  const res = await postAuth(ctx, "/passkey/verify-authentication", withCookies(null, options), {
    response: authenticator.authenticate(options.json()),
  });
  expect(res.statusCode).toBeGreaterThanOrEqual(500);
  const line = logs.entries().find((entry) => JSON.stringify(entry).includes("DrizzleQueryError"));
  expect(line).toMatchObject({ level: "error" });
  const log = logs.text();
  expect(log).toContain(QUERY_ERROR_MESSAGE);
  expect(log).not.toContain("Failed query:");
  expect(log).not.toContain("params");
  expect(log).not.toContain("credential_id");
  expect(log).not.toContain(authenticator.credentialId);
});

test("when deleting the replaced session fails in the database, its token is not logged", async () => {
  await ctx.close();
  const logs = createTestLogger("debug");
  ctx = await createTestApp({ LOG_LEVEL: "debug" }, { logger: logs.logger });
  const admin = await adminWithPasskey();
  const token = sessionTokenOf(admin.cookie);
  expect(token).toBeTruthy();
  const options = await postAuth(ctx, "/passkey/generate-authenticate-options", admin.cookie);
  const { internalAdapter } = await ctx.app.auth.$context;
  // A real failed query with the token as its parameter. The worst case: Drizzle's
  // `paramsInErrors` on (it is off in `createDb`) puts it in the message, PostgreSQL in its own.
  const loud = drizzle({ client: ctx.t.pool, paramsInErrors: true });
  const spy = vi.spyOn(internalAdapter, "deleteSession").mockImplementation(async (value) => {
    await loud.execute(sql`select ${value}::uuid`);
  });
  const res = await postAuth(
    ctx,
    "/passkey/verify-authentication",
    withCookies(admin.cookie, options),
    {
      response: admin.authenticator.authenticate(options.json()),
    },
  );
  spy.mockRestore();
  expect(res.statusCode).toBe(500);
  expect(logs.entries()).toContainEqual(
    expect.objectContaining({
      level: "error",
      msg: "Better Auth: Deleting the replaced session failed",
      errors: [
        {
          type: "DrizzleQueryError",
          message: QUERY_ERROR_MESSAGE,
          cause: expect.objectContaining({ code: "22P02" }),
        },
      ],
    }),
  );
  const log = logs.text();
  expect(log).not.toContain(token);
  expect(log).not.toContain("Failed query:");
});
