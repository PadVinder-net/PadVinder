import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createOrganization } from "./admin";
import type { MailJob, QueueMail } from "./mail-jobs";
import {
  countPasskeys,
  listOwnPasskeys,
  MAX_PASSKEYS_PER_ACCOUNT,
  recordPasskeyAdded,
  removeOwnPasskey,
  resetPasskeys,
} from "./passkeys";
import { auditLogEntries, passkeys, sessions, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
const db = () => t!.db;
let counter = 0;

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

async function newUser(label: string): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: `Naam ${label}`, email: `${label}-${++counter}@example.test` })
    .returning({ id: users.id });
  return row!.id;
}

async function newPasskey(userId: string, createdAt = new Date()): Promise<string> {
  const [row] = await db()
    .insert(passkeys)
    .values({
      userId,
      publicKey: `public-key-${++counter}`,
      credentialID: `credential-id-${counter}`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: counter % 2 === 0,
      createdAt,
    })
    .returning({ id: passkeys.id });
  return row!.id;
}

async function newSession(userId: string, verified: Date | null): Promise<string> {
  const [row] = await db()
    .insert(sessions)
    .values({
      userId,
      token: `token-${++counter}`,
      expiresAt: new Date(Date.now() + 86_400_000),
      passkeyVerifiedAt: verified,
    })
    .returning({ id: sessions.id });
  return row!.id;
}

function collector() {
  const jobs: MailJob[] = [];
  const queueMail: QueueMail = async (_tx, job) => {
    jobs.push(job);
  };
  return { jobs, queueMail };
}

const entries = () => db().select().from(auditLogEntries);
const verifiedAt = async (sessionId: string) =>
  (await db().select().from(sessions).where(eq(sessions.id, sessionId)))[0]!.passkeyVerifiedAt;

test("the limit is ten", () => {
  expect(MAX_PASSKEYS_PER_ACCOUNT).toBe(10);
});

test("listOwnPasskeys gives id, createdAt and backedUp, oldest first, and only the user's own", async () => {
  const user = await newUser("list");
  const other = await newUser("list-other");
  const newer = await newPasskey(user, new Date("2027-01-02T10:00:00Z"));
  const older = await newPasskey(user, new Date("2027-01-01T10:00:00Z"));
  await newPasskey(other);
  const list = await listOwnPasskeys(db(), user);
  expect(list.map((p) => p.id)).toEqual([older, newer]);
  expect(Object.keys(list[0]!).sort()).toEqual(["backedUp", "createdAt", "id"]);
  expect(list[0]!.createdAt).toEqual(new Date("2027-01-01T10:00:00Z"));
  expect(typeof list[0]!.backedUp).toBe("boolean");
  expect(await countPasskeys(db(), user)).toBe(2);
  expect(await countPasskeys(db(), await newUser("none"))).toBe(0);
});

test("recordPasskeyAdded writes passkey.added without details and queues passkey-added with IDs only", async () => {
  const user = await newUser("added");
  const passkeyId = await newPasskey(user);
  const { jobs, queueMail } = collector();
  await recordPasskeyAdded(db(), { userId: user, passkeyId }, { queueMail });
  const [entry] = (await entries()).filter((e) => e.subjectId === user);
  expect(entry).toMatchObject({
    action: "passkey.added",
    actorKind: "user",
    actorUserId: user,
    organizationId: null,
    subjectType: "user",
    details: {},
  });
  expect(jobs).toEqual([{ kind: "passkey-added", userId: user, passkeyId }]);
});

test("recordPasskeyAdded works without a mail queue", async () => {
  const user = await newUser("added-nomail");
  await recordPasskeyAdded(db(), { userId: user, passkeyId: await newPasskey(user) }, {});
  expect((await entries()).filter((e) => e.subjectId === user)).toHaveLength(1);
});

test("removeOwnPasskey removes the user's own and answers not_found for someone else's, which stays", async () => {
  const user = await newUser("remove");
  const other = await newUser("remove-other");
  const mine = await newPasskey(user);
  const theirs = await newPasskey(other);
  const { jobs, queueMail } = collector();
  expect(await removeOwnPasskey(db(), { userId: user, passkeyId: theirs }, { queueMail })).toEqual({
    outcome: "not_found",
  });
  expect(await countPasskeys(db(), other)).toBe(1);
  expect(jobs).toEqual([]);
  expect((await entries()).filter((e) => e.subjectId === user)).toEqual([]);
  expect(await removeOwnPasskey(db(), { userId: user, passkeyId: mine }, { queueMail })).toEqual({
    outcome: "removed",
  });
  expect(await countPasskeys(db(), user)).toBe(0);
  // Gone now: a second call finds nothing.
  expect(await removeOwnPasskey(db(), { userId: user, passkeyId: mine }, { queueMail })).toEqual({
    outcome: "not_found",
  });
});

test("removeOwnPasskey writes passkey.removed and queues passkeys-removed with byUserId the user, and keeps the session moments", async () => {
  const user = await newUser("remove-audit");
  const passkeyId = await newPasskey(user);
  const moment = new Date("2027-01-10T10:00:00Z");
  const session = await newSession(user, moment);
  const { jobs, queueMail } = collector();
  await removeOwnPasskey(db(), { userId: user, passkeyId }, { queueMail });
  expect((await entries()).filter((e) => e.subjectId === user)).toMatchObject([
    { action: "passkey.removed", actorUserId: user, organizationId: null, details: {} },
  ]);
  expect(jobs).toEqual([{ kind: "passkeys-removed", userId: user, byUserId: user }]);
  expect(await verifiedAt(session)).toEqual(moment);
});

test("resetPasskeys removes all, clears passkey_verified_at on every session of that person and of nobody else", async () => {
  const user = await newUser("reset");
  const bystander = await newUser("reset-other");
  const admin = await newUser("reset-admin");
  await newPasskey(user);
  await newPasskey(user);
  await newPasskey(bystander);
  const moment = new Date("2027-01-10T10:00:00Z");
  const s1 = await newSession(user, moment);
  const s2 = await newSession(user, moment);
  const s3 = await newSession(user, null);
  const sOther = await newSession(bystander, moment);
  const { jobs, queueMail } = collector();
  expect(
    await resetPasskeys(
      db(),
      { userId: user, organizationId: null },
      { kind: "user", userId: admin },
      { queueMail },
    ),
  ).toEqual({ removed: 2 });
  expect(await countPasskeys(db(), user)).toBe(0);
  expect(await countPasskeys(db(), bystander)).toBe(1);
  expect(await verifiedAt(s1)).toBeNull();
  expect(await verifiedAt(s2)).toBeNull();
  expect(await verifiedAt(s3)).toBeNull();
  expect(await verifiedAt(sOther)).toEqual(moment);
  expect(jobs).toEqual([{ kind: "passkeys-removed", userId: user, byUserId: admin }]);
});

test("resetPasskeys writes passkey.reset with the organization given, or none", async () => {
  const admin = await newUser("reset-actor");
  const { id: organizationId } = await createOrganization(
    db(),
    { name: "Reset organisatie", adminEmail: "reset-org-admin@example.test" },
    { kind: "system" },
  );
  const withOrg = await newUser("reset-org");
  const withoutOrg = await newUser("reset-noorg");
  await newPasskey(withOrg);
  await newPasskey(withoutOrg);
  const actor = { kind: "user", userId: admin } as const;
  await resetPasskeys(db(), { userId: withOrg, organizationId }, actor, {});
  await resetPasskeys(db(), { userId: withoutOrg, organizationId: null }, actor, {});
  const all = await entries();
  expect(all.find((e) => e.subjectId === withOrg)).toMatchObject({
    action: "passkey.reset",
    actorUserId: admin,
    organizationId,
    subjectType: "user",
    details: {},
  });
  expect(all.find((e) => e.subjectId === withoutOrg)).toMatchObject({
    action: "passkey.reset",
    organizationId: null,
  });
});

test("resetPasskeys of a person without passkeys clears the sessions and writes no entry and no mail", async () => {
  const user = await newUser("reset-empty");
  const admin = await newUser("reset-empty-admin");
  const session = await newSession(user, new Date("2027-01-10T10:00:00Z"));
  const { jobs, queueMail } = collector();
  expect(
    await resetPasskeys(
      db(),
      { userId: user, organizationId: null },
      { kind: "user", userId: admin },
      { queueMail },
    ),
  ).toEqual({ removed: 0 });
  expect(await verifiedAt(session)).toBeNull();
  expect((await entries()).filter((e) => e.subjectId === user)).toEqual([]);
  expect(jobs).toEqual([]);
});

test("no entry and no job holds a name, an address or a credential ID", async () => {
  const user = await newUser("raw");
  const admin = await newUser("raw-admin");
  const first = await newPasskey(user);
  const second = await newPasskey(user);
  const credentials = (await db().select().from(passkeys).where(eq(passkeys.userId, user))).map(
    (p) => p.credentialID,
  );
  const { jobs, queueMail } = collector();
  await recordPasskeyAdded(db(), { userId: user, passkeyId: first }, { queueMail });
  await removeOwnPasskey(db(), { userId: user, passkeyId: first }, { queueMail });
  await resetPasskeys(
    db(),
    { userId: user, organizationId: null },
    { kind: "user", userId: admin },
    { queueMail },
  );
  expect(second).toBeTruthy();
  const raw = JSON.stringify([(await entries()).filter((e) => e.subjectId === user), jobs]);
  expect(raw).not.toContain("@");
  expect(raw).not.toContain("Naam ");
  for (const credential of credentials) expect(raw).not.toContain(credential);
});
