import type { LiveEvent } from "@padvinder/contracts";
import { and, eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { getAccess } from "./access";
import { deleteAccount, deletedAccountEmail, DELETED_ACCOUNT_NAME } from "./accounts";
import {
  AdminError,
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  revokePlatformAdmin,
} from "./admin";
import { getMeRoles } from "./me";
import {
  createMembershipRequest,
  decideMembershipRequest,
  getMembershipRequestForReview,
} from "./membership-requests";
import { liveEventsChannel, notify } from "./notifications";
import {
  accounts,
  auditLogEntries,
  loginCodeRequests,
  membershipRequests,
  organizationAdmins,
  sessions,
  users,
  verifications,
  workingGroupMemberships,
} from "./schema";
import type { Db } from "./client";
import { createTestDatabase, type TestDatabase } from "./testing";
import { getUserProfile, updateUserProfile } from "./users";

let t: TestDatabase | undefined;
const db = () => t!.db;
const system = { kind: "system" } as const;

let organizationId: string;
let groups: string[];

beforeAll(async () => {
  t = await createTestDatabase();
  organizationId = (await createOrganization(db(), { name: "Verwijder Org" }, system)).id;
  groups = [];
  for (const name of ["Noord", "Zuid", "Oost"]) {
    groups.push(
      (await createWorkingGroup(db(), { organizationId, name, city: "Voorbeeldstad" }, system)).id,
    );
  }
  // Every test that is not about the last platform admin has another one around, who has
  // logged in (only such an admin counts, see `hasOtherPlatformAdmin`).
  await grantPlatformAdmin(db(), { email: "blijvende-beheerder@example.test" }, system);
  await logIn(db(), "blijvende-beheerder@example.test");
});
afterAll(async () => {
  await t?.drop();
});

/** What the first login does to an account the tool made: Better Auth verifies the address. */
async function logIn(database: Db, email: string) {
  await database.update(users).set({ emailVerified: true }).where(eq(users.email, email));
}

let userCount = 0;
/** A user with a name, an address, a phone number, a session, an account row and a login code. */
async function newUser(): Promise<{ id: string; email: string }> {
  const email = `verwijder-${userCount++}@example.test`;
  const [row] = await db()
    .insert(users)
    .values({
      name: "Noor de Vries",
      email,
      phone: "06 12345678",
      image: "https://example.test/noor.png",
      emailVerified: true,
    })
    .returning({ id: users.id });
  const id = row!.id;
  await db()
    .insert(sessions)
    .values({ userId: id, token: `token-${id}`, expiresAt: new Date(Date.now() + 86_400_000) });
  await db().insert(accounts).values({ userId: id, accountId: id, providerId: "email-otp" });
  await db()
    .insert(verifications)
    .values({
      identifier: `sign-in-otp-${email}`,
      value: "encrypted",
      expiresAt: new Date(Date.now() + 1_800_000),
    });
  await db().insert(loginCodeRequests).values({ email, requestedAt: new Date() });
  return { id, email };
}

/** A UUIDv7 made the way the app makes one. */
function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request(userId: string, workingGroupId: string): Promise<string> {
  const id = uuidv7();
  const result = await createMembershipRequest(db(), {
    id,
    userId,
    workingGroupId,
    requestedAt: new Date("2027-01-10T18:00:00Z"),
    now: new Date(),
  });
  if (result.outcome !== "created") throw new Error(`Expected created, got ${result.outcome}`);
  return id;
}

const now = new Date("2027-01-12T20:00:00Z");
const userRow = async (id: string) => (await db().select().from(users).where(eq(users.id, id)))[0]!;

/** Same pattern as in membership-requests.test.ts: `drain()` returns what arrived before a marker. */
async function listenForLiveEvents() {
  const listener = new pg.Client({ connectionString: t!.url });
  await listener.connect();
  const received: LiveEvent[] = [];
  let arrived: (() => void) | undefined;
  listener.on("notification", (message) => {
    received.push(liveEventsChannel.schema.parse(JSON.parse(message.payload ?? "")));
    arrived?.();
  });
  await listener.query(`LISTEN ${liveEventsChannel.name}`);
  let markers = 0;
  return {
    async drain(): Promise<LiveEvent[]> {
      const beatAt = new Date(Date.UTC(2027, 2, 2, 19, 30, markers++)).toISOString();
      await db().transaction((tx) =>
        notify(tx, liveEventsChannel, { type: "worker-heartbeat", beatAt }),
      );
      const isMarker = (e: LiveEvent) => e.type === "worker-heartbeat" && e.beatAt === beatAt;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The marker did not arrive")), 5_000);
        const check = () => {
          if (!received.some(isMarker)) return;
          clearTimeout(timer);
          resolve();
        };
        arrived = check;
        check();
      });
      const index = received.findIndex(isMarker);
      return received.splice(0, index + 1).slice(0, index);
    },
    close: () => listener.end(),
  };
}

test("the deleted address is unique, never deliverable, and the name is fixed", () => {
  expect(DELETED_ACCOUNT_NAME).toBe("Verwijderd account");
  expect(deletedAccountEmail("0193a5e0-0000-7000-8000-000000000001")).toBe(
    "deleted-0193a5e0-0000-7000-8000-000000000001@deleted.invalid",
  );
});

test("wipes the personal fields, removes the admin flag and keeps the row", async () => {
  const user = await newUser();
  await db().update(users).set({ isPlatformAdmin: true }).where(eq(users.id, user.id));
  expect(await deleteAccount(db(), { userId: user.id, now })).toEqual({ outcome: "deleted" });
  const row = await userRow(user.id);
  expect(row).toMatchObject({
    id: user.id,
    name: "Verwijderd account",
    email: `deleted-${user.id}@deleted.invalid`,
    phone: null,
    image: null,
    emailVerified: false,
    isPlatformAdmin: false,
    deletedAt: now,
  });
});

test("deletes the sessions, account rows, login codes and code requests of the address only", async () => {
  const user = await newUser();
  const other = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  expect(await db().select().from(sessions).where(eq(sessions.userId, user.id))).toEqual([]);
  expect(await db().select().from(accounts).where(eq(accounts.userId, user.id))).toEqual([]);
  expect(
    await db()
      .select()
      .from(verifications)
      .where(eq(verifications.identifier, `sign-in-otp-${user.email}`)),
  ).toEqual([]);
  expect(
    await db().select().from(loginCodeRequests).where(eq(loginCodeRequests.email, user.email)),
  ).toEqual([]);
  // The other user keeps everything.
  expect(await db().select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(1);
  expect(await db().select().from(accounts).where(eq(accounts.userId, other.id))).toHaveLength(1);
  expect(
    await db()
      .select()
      .from(verifications)
      .where(eq(verifications.identifier, `sign-in-otp-${other.email}`)),
  ).toHaveLength(1);
  expect(
    await db().select().from(loginCodeRequests).where(eq(loginCodeRequests.email, other.email)),
  ).toHaveLength(1);
});

test("deletes memberships and admin rows, withdraws pending requests and keeps decided ones", async () => {
  const user = await newUser();
  const coordinator = await newUser();
  await grantCoordinator(db(), { email: user.email, workingGroupId: groups[0]! }, system);
  await grantOrganizationAdmin(db(), { email: user.email, organizationId }, system);
  const pendingA = await request(user.id, groups[1]!);
  const pendingB = await request(user.id, groups[2]!);
  // Someone else's request that the user rejected earlier stays as it was.
  const rejectedId = await request(coordinator.id, groups[1]!);
  await decideMembershipRequest(db(), {
    id: rejectedId,
    decision: "rejected",
    decidedBy: user.id,
    now: new Date("2027-01-11T10:00:00Z"),
  });

  const events = await listenForLiveEvents();
  try {
    await deleteAccount(db(), { userId: user.id, now });
    const received = await events.drain();
    expect(received).toHaveLength(3);
    expect(received).toEqual(
      expect.arrayContaining([
        { type: "membership-requests-changed", workingGroupId: groups[1]!, organizationId },
        { type: "membership-requests-changed", workingGroupId: groups[2]!, organizationId },
        { type: "access-changed", userId: user.id },
      ]),
    );
  } finally {
    await events.close();
  }

  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, user.id)),
  ).toEqual([]);
  expect(
    await db().select().from(organizationAdmins).where(eq(organizationAdmins.userId, user.id)),
  ).toEqual([]);
  const requests = await db()
    .select()
    .from(membershipRequests)
    .where(inArray(membershipRequests.id, [pendingA, pendingB]));
  expect(requests.map((r) => [r.status, r.decidedAt])).toEqual([
    ["withdrawn", now],
    ["withdrawn", now],
  ]);
  // The request the deleted user decided still points at them.
  const [rejected] = await db()
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, rejectedId));
  expect(rejected).toMatchObject({ status: "rejected", decidedByUserId: user.id });
});

test("a decided request of the deleted user stays and shows the fixed name, without contact details", async () => {
  const user = await newUser();
  const decider = await newUser();
  const id = await request(user.id, groups[0]!);
  await decideMembershipRequest(db(), { id, decision: "rejected", decidedBy: decider.id, now });
  await deleteAccount(db(), { userId: user.id, now });
  const stored = await getMembershipRequestForReview(db(), id);
  expect(stored?.status).toBe("rejected");
  // No contact keys at all: not an empty string, not null.
  expect(stored?.applicant).toStrictEqual({ id: user.id, name: "Verwijderd account" });
});

test("writes one audit entry: the user deleted themselves, without details", async () => {
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  const entries = await db()
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectId, user.id), eq(auditLogEntries.action, "account.deleted")),
    );
  expect(entries).toEqual([
    expect.objectContaining({
      actorKind: "user",
      actorUserId: user.id,
      organizationId: null,
      subjectType: "user",
      subjectId: user.id,
      details: {},
    }),
  ]);
});

test("an unknown user and a deleted user are not_found, and nothing is written twice", async () => {
  expect(await deleteAccount(db(), { userId: uuidv7(), now })).toEqual({ outcome: "not_found" });
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  const later = new Date("2027-02-01T12:00:00Z");
  expect(await deleteAccount(db(), { userId: user.id, now: later })).toEqual({
    outcome: "not_found",
  });
  expect((await userRow(user.id)).deletedAt).toEqual(now);
  const entries = await db()
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectId, user.id), eq(auditLogEntries.action, "account.deleted")),
    );
  expect(entries).toHaveLength(1);
});

test("the only platform admin cannot delete their account; nothing changes", async () => {
  const fresh = await createTestDatabase();
  try {
    await grantPlatformAdmin(fresh.db, { email: "enige@example.test" }, system);
    const [admin] = await fresh.db
      .select()
      .from(users)
      .where(eq(users.email, "enige@example.test"));
    // An admin flag left on a deleted row (never written, but possible by hand) does not count.
    await fresh.db.insert(users).values({
      name: DELETED_ACCOUNT_NAME,
      email: "deleted-handwerk@deleted.invalid",
      isPlatformAdmin: true,
      deletedAt: now,
    });
    expect(await deleteAccount(fresh.db, { userId: admin!.id, now })).toEqual({
      outcome: "last_platform_admin",
    });
    const [after] = await fresh.db.select().from(users).where(eq(users.id, admin!.id));
    expect(after).toMatchObject({ email: "enige@example.test", isPlatformAdmin: true });
    expect(after!.deletedAt).toBeNull();

    // A second platform admin who never logged in (a mistyped address) does not count either.
    await grantPlatformAdmin(fresh.db, { email: "tweede@example.test" }, system);
    expect(await deleteAccount(fresh.db, { userId: admin!.id, now })).toEqual({
      outcome: "last_platform_admin",
    });
    await logIn(fresh.db, "tweede@example.test");
    expect(await deleteAccount(fresh.db, { userId: admin!.id, now })).toEqual({
      outcome: "deleted",
    });
    // The second one is now the last one; revoking them is refused too.
    await expect(
      revokePlatformAdmin(fresh.db, { email: "tweede@example.test" }, system),
    ).rejects.toThrow(AdminError);
  } finally {
    await fresh.drop();
  }
});

test("a deleted user has no access, no profile and no me", async () => {
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  expect(await getAccess(db(), user.id)).toBeNull();
  expect(await getUserProfile(db(), user.id)).toBeNull();
  expect(await getMeRoles(db(), user.id)).toEqual({
    memberships: [],
    organizationAdminOf: [],
    membershipRequest: null,
  });
});

test("a profile change after the deletion changes nothing", async () => {
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  expect(await updateUserProfile(db(), user.id, { name: "Noor", phone: "06 1" })).toBeNull();
  expect(await userRow(user.id)).toMatchObject({ name: DELETED_ACCOUNT_NAME, phone: null });
});

test("a request after the deletion is refused and not stored", async () => {
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  const result = await createMembershipRequest(db(), {
    id: uuidv7(),
    userId: user.id,
    workingGroupId: groups[0]!,
    requestedAt: now,
    now,
  });
  expect(result).toEqual({ outcome: "user_not_found" });
  expect(
    await db().select().from(membershipRequests).where(eq(membershipRequests.userId, user.id)),
  ).toEqual([]);
});

test("the admin tool cannot give a deleted account a role through its replaced address", async () => {
  const user = await newUser();
  await deleteAccount(db(), { userId: user.id, now });
  const address = deletedAccountEmail(user.id);
  await expect(
    grantCoordinator(db(), { email: address, workingGroupId: groups[0]! }, system),
  ).rejects.toMatchObject({ code: "user_not_found" });
  await expect(grantPlatformAdmin(db(), { email: address }, system)).rejects.toMatchObject({
    code: "user_not_found",
  });
  expect((await userRow(user.id)).isPlatformAdmin).toBe(false);
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, user.id)),
  ).toEqual([]);
});

test("two deletions at the same moment: one deleted, one not_found, one audit entry", async () => {
  const user = await newUser();
  const results = await Promise.all([
    deleteAccount(db(), { userId: user.id, now }),
    deleteAccount(db(), { userId: user.id, now }),
  ]);
  expect(results.map((r) => r.outcome).sort()).toEqual(["deleted", "not_found"]);
  const entries = await db()
    .select()
    .from(auditLogEntries)
    .where(
      and(eq(auditLogEntries.subjectId, user.id), eq(auditLogEntries.action, "account.deleted")),
    );
  expect(entries).toHaveLength(1);
});

test("the only two platform admins deleting themselves at the same moment: exactly one may", async () => {
  const fresh = await createTestDatabase();
  try {
    const ids: string[] = [];
    for (const email of ["een@example.test", "twee@example.test"]) {
      await grantPlatformAdmin(fresh.db, { email }, system);
      await logIn(fresh.db, email);
      const [row] = await fresh.db.select().from(users).where(eq(users.email, email));
      ids.push(row!.id);
    }
    const results = await Promise.all(
      ids.map((userId) => deleteAccount(fresh.db, { userId, now })),
    );
    expect(results.map((r) => r.outcome).sort()).toEqual(["deleted", "last_platform_admin"]);
    const admins = await fresh.db.select().from(users).where(eq(users.isPlatformAdmin, true));
    expect(admins).toHaveLength(1);
    expect(admins[0]!.deletedAt).toBeNull();
  } finally {
    await fresh.drop();
  }
});

/** Waits until some connection of this database waits on a lock; fails after two seconds. */
async function waitUntilBlocked(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const [blocked] = await db()
      .execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
      )
      .then((r) => r.rows);
    if (blocked!.n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("No connection waited on a lock");
}

test("an approval that holds the request while the account is deleted: no deadlock", async () => {
  // The approval's own order (decideMembershipRequest): lock the request row, update it, then
  // insert the membership, whose foreign key check takes a share lock on the users row.
  const user = await newUser();
  const decider = await newUser();
  const id = await request(user.id, groups[0]!);
  let continueApproval!: () => void;
  const resume = new Promise<void>((resolve) => (continueApproval = resolve));
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const approval = db().transaction(async (tx) => {
    await tx.execute(sql`select id from membership_requests where id = ${id} for update`);
    await tx
      .update(membershipRequests)
      .set({ status: "approved", decidedAt: now, decidedByUserId: decider.id })
      .where(eq(membershipRequests.id, id));
    locked();
    await resume;
    await tx
      .insert(workingGroupMemberships)
      .values({ userId: user.id, workingGroupId: groups[0]! });
  });
  await ready;
  const deletion = deleteAccount(db(), { userId: user.id, now });
  await waitUntilBlocked();
  continueApproval();
  // Both finish: before the fix, PostgreSQL ended one of them with "deadlock detected".
  await approval;
  expect(await deletion).toEqual({ outcome: "deleted" });
  // The approval came first; the deletion then removed the membership it made.
  const [stored] = await db()
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, id));
  expect(stored!.status).toBe("approved");
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, user.id)),
  ).toEqual([]);
});

test("a deletion and an approval waiting for the same request: no deadlock, no membership", async () => {
  const user = await newUser();
  const decider = await newUser();
  const id = await request(user.id, groups[0]!);
  // Hold the user's request lock, as a deletion in progress does, then let the deletion run.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const holder = db().transaction(async (tx) => {
    await tx.execute(sql`select id from membership_requests where id = ${id} for update`);
    locked();
    await released;
  });
  await ready;
  const deletion = deleteAccount(db(), { userId: user.id, now });
  const decision = decideMembershipRequest(db(), {
    id,
    decision: "approved",
    decidedBy: decider.id,
    now,
  });
  await waitUntilBlocked();
  release();
  await holder;
  const [deleted, decided] = await Promise.all([deletion, decision]);
  expect(deleted).toEqual({ outcome: "deleted" });
  // Whichever got the row first: never a membership of the deleted account.
  expect(["already_decided", "decided"]).toContain(decided.outcome);
  expect(
    await db()
      .select()
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, user.id)),
  ).toEqual([]);
});
