import type { LiveEvent } from "@padvinder/contracts";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  addMemberByEmail,
  countAdditionsInLastDay,
  normalizeEmailList,
  type AddMemberOutcome,
} from "./add-members";
import { createOrganization, createWorkingGroup, lockWorkingGroup } from "./admin";
import { mailJobSchema, type MailJob, type QueueMail } from "./mail-jobs";
import { createMembershipRequest } from "./membership-requests";
import { liveEventsChannel, notify } from "./notifications";
import { auditLogEntries, membershipRequests, users, workingGroupMemberships } from "./schema";
import { createTestDatabase, holdLock, waitUntilBlocked, type TestDatabase } from "./testing";

const system = { kind: "system" } as const;
let t: TestDatabase | undefined;
// A fresh database per test: the audit log cannot be emptied.
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t?.drop();
});

const db = () => t!.db;
const HOUR = 60 * 60 * 1000;

/** A queue that checks every job by the schema and keeps it. */
function recordingQueue(): { queueMail: QueueMail; jobs: MailJob[] } {
  const jobs: MailJob[] = [];
  return {
    jobs,
    async queueMail(_tx, job) {
      jobs.push(mailJobSchema.parse(job));
    },
  };
}

async function setup() {
  const organization = await createOrganization(
    db(),
    { name: "Paddentrek Voorbeeldstad", adminEmail: "beheer@example.test" },
    system,
  );
  const group = await createWorkingGroup(
    db(),
    {
      organizationId: organization.id,
      name: "Noord",
      city: "Voorbeeldstad",
      coordinatorEmail: "coordinator@example.test",
    },
    system,
  );
  const other = await createWorkingGroup(
    db(),
    {
      organizationId: organization.id,
      name: "Zuid",
      city: "Voorbeeldstad",
      coordinatorEmail: "coordinator@example.test",
    },
    system,
  );
  return {
    organizationId: organization.id,
    workingGroupId: group.id,
    otherWorkingGroupId: other.id,
    addedBy: group.coordinatorUserId,
  };
}

/** An account that has logged in before, with a name and a phone number. */
async function loggedInUser(email: string): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({
      name: "Bert Bekend",
      email,
      phone: "06 12345678",
      emailVerified: true,
      lastLoginAt: new Date(),
    })
    .returning({ id: users.id });
  return row!.id;
}

/** An account the tool or an earlier adding made, never logged in. */
async function unusedUser(email: string): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({ name: "", email, emailVerified: false })
    .returning({ id: users.id });
  return row!.id;
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

async function requestToJoin(userId: string, workingGroupId: string): Promise<string> {
  const id = uuidv7();
  const result = await createMembershipRequest(db(), {
    id,
    userId,
    workingGroupId,
    requestedAt: new Date(),
    now: new Date(),
  });
  if (result.outcome !== "created") throw new Error(`Expected created, got ${result.outcome}`);
  return id;
}

const membershipsOf = (userId: string) =>
  db().select().from(workingGroupMemberships).where(eq(workingGroupMemberships.userId, userId));

const entriesAbout = (userId: string) =>
  db().select().from(auditLogEntries).where(eq(auditLogEntries.subjectId, userId));

const userByEmail = async (email: string) =>
  (await db().select().from(users).where(eq(users.email, email)))[0];

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
      const beatAt = new Date(Date.UTC(2027, 2, 3, 19, 30, markers++)).toISOString();
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

test("a new address gets an account without a name, a membership, one entry, the event and one queued mail", async () => {
  const { organizationId, workingGroupId, addedBy } = await setup();
  const queue = recordingQueue();
  const events = await listenForLiveEvents();
  try {
    const result = await addMemberByEmail(
      db(),
      { workingGroupId, email: "  Nieuw@Example.TEST ", addedBy, now: new Date() },
      { queueMail: queue.queueMail },
    );
    expect(result).toEqual({ email: "nieuw@example.test", outcome: "added" });
    const user = await userByEmail("nieuw@example.test");
    expect(user).toMatchObject({ name: "", lastLoginAt: null, deletedAt: null });
    const memberships = await membershipsOf(user!.id);
    expect(memberships).toMatchObject([{ workingGroupId, isCoordinator: false }]);
    const entries = await entriesAbout(user!.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "membership.added",
      actorKind: "user",
      actorUserId: addedBy,
      organizationId,
      subjectType: "user",
      details: { workingGroupId },
    });
    expect(await events.drain()).toEqual([{ type: "access-changed", userId: user!.id }]);
    expect(queue.jobs).toEqual([
      { kind: "added-to-working-group", membershipId: memberships[0]!.id, byUserId: addedBy },
    ]);
  } finally {
    await events.close();
  }
});

test("an account that never logged in is added the same way", async () => {
  const { workingGroupId, addedBy } = await setup();
  const userId = await unusedUser("ongebruikt@example.test");
  const queue = recordingQueue();
  const result = await addMemberByEmail(
    db(),
    { workingGroupId, email: "ongebruikt@example.test", addedBy, now: new Date() },
    { queueMail: queue.queueMail },
  );
  expect(result).toEqual({ email: "ongebruikt@example.test", outcome: "added" });
  const memberships = await membershipsOf(userId);
  expect(memberships).toMatchObject([{ workingGroupId, isCoordinator: false }]);
  expect((await entriesAbout(userId)).map((e) => e.action)).toEqual(["membership.added"]);
  expect(queue.jobs).toEqual([
    { kind: "added-to-working-group", membershipId: memberships[0]!.id, byUserId: addedBy },
  ]);
});

test("a member is already_member and nothing changes", async () => {
  const { workingGroupId, addedBy } = await setup();
  const queue = recordingQueue();
  for (const email of ["coordinator@example.test", "lid@example.test"]) {
    if (email === "lid@example.test") {
      const userId = await loggedInUser(email);
      await db().insert(workingGroupMemberships).values({ userId, workingGroupId });
    }
    const before = await db().select().from(auditLogEntries);
    const result = await addMemberByEmail(
      db(),
      { workingGroupId, email, addedBy, now: new Date() },
      { queueMail: queue.queueMail },
    );
    expect(result).toEqual({ email, outcome: "already_member" });
    expect(await db().select().from(auditLogEntries)).toHaveLength(before.length);
  }
  const [coordinator] = await membershipsOf(addedBy);
  expect(coordinator).toMatchObject({ isCoordinator: true });
  expect(queue.jobs).toEqual([]);
});

test("someone who logged in before is not added", async () => {
  const { organizationId, workingGroupId, addedBy } = await setup();
  const userId = await loggedInUser("bekend@example.test");
  const queue = recordingQueue();
  const result = await addMemberByEmail(
    db(),
    { workingGroupId, email: "Bekend@Example.test", addedBy, now: new Date() },
    { queueMail: queue.queueMail },
  );
  expect(result).toEqual({ email: "bekend@example.test", outcome: "invited" });
  expect(JSON.stringify(result)).not.toMatch(/Bert|06 12345678/);
  expect(await membershipsOf(userId)).toEqual([]);
  const entries = await entriesAbout(userId);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    action: "membership.invited",
    actorUserId: addedBy,
    organizationId,
    subjectType: "user",
    details: { workingGroupId },
  });
  expect(queue.jobs).toEqual([
    { kind: "invited-to-working-group", userId, workingGroupId, byUserId: addedBy },
  ]);
});

test("a second invitation within 24 hours writes no entry and queues no mail; after 24 hours it does", async () => {
  const { workingGroupId, otherWorkingGroupId, addedBy } = await setup();
  const userId = await loggedInUser("bekend@example.test");
  const queue = recordingQueue();
  const invite = (now: Date, group = workingGroupId) =>
    addMemberByEmail(
      db(),
      { workingGroupId: group, email: "bekend@example.test", addedBy, now },
      { queueMail: queue.queueMail },
    );
  const now = new Date();
  expect((await invite(now)).outcome).toBe("invited");
  expect((await invite(new Date(now.getTime() + 23 * HOUR))).outcome).toBe("invited");
  expect(await entriesAbout(userId)).toHaveLength(1);
  expect(queue.jobs).toHaveLength(1);
  // Another group is another invitation.
  expect((await invite(now, otherWorkingGroupId)).outcome).toBe("invited");
  expect(queue.jobs).toHaveLength(2);
  expect((await invite(new Date(now.getTime() + 25 * HOUR))).outcome).toBe("invited");
  expect(await entriesAbout(userId)).toHaveLength(3);
  expect(queue.jobs).toHaveLength(3);
});

test("someone who logged in before and asked for this group is approved, decided by the adder", async () => {
  const { workingGroupId, addedBy } = await setup();
  const userId = await loggedInUser("aanmelder@example.test");
  const requestId = await requestToJoin(userId, workingGroupId);
  const queue = recordingQueue();
  const now = new Date();
  const result = await addMemberByEmail(
    db(),
    { workingGroupId, email: "aanmelder@example.test", addedBy, now },
    { queueMail: queue.queueMail },
  );
  expect(result).toMatchObject({
    email: "aanmelder@example.test",
    outcome: "approved",
    approvedRequest: { id: requestId, userId, status: "approved", decidedAt: now },
  });
  const [request] = await db()
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, requestId));
  expect(request).toMatchObject({ status: "approved", decidedByUserId: addedBy });
  expect(await membershipsOf(userId)).toMatchObject([{ workingGroupId, isCoordinator: false }]);
  const entries = await db()
    .select()
    .from(auditLogEntries)
    .where(eq(auditLogEntries.subjectId, requestId));
  expect(entries).toMatchObject([
    { action: "membership_request.approved", actorUserId: addedBy, details: { workingGroupId } },
  ]);
  expect(await entriesAbout(userId)).toEqual([]);
  expect(queue.jobs).toEqual([]);
});

test("a pending request for another group does not count", async () => {
  const { workingGroupId, otherWorkingGroupId, addedBy } = await setup();
  const userId = await loggedInUser("aanmelder@example.test");
  const requestId = await requestToJoin(userId, otherWorkingGroupId);
  const queue = recordingQueue();
  const result = await addMemberByEmail(
    db(),
    { workingGroupId, email: "aanmelder@example.test", addedBy, now: new Date() },
    { queueMail: queue.queueMail },
  );
  expect(result).toEqual({ email: "aanmelder@example.test", outcome: "invited" });
  const [request] = await db()
    .select()
    .from(membershipRequests)
    .where(eq(membershipRequests.id, requestId));
  expect(request).toMatchObject({ status: "pending" });
  expect(await membershipsOf(userId)).toEqual([]);
});

test.each(["jan@", "", "deleted-0192f3c0-0000-7000-8000-000000000001@deleted.invalid"])(
  "%j is invalid and nothing is written",
  async (email) => {
    const { workingGroupId, addedBy } = await setup();
    const usersBefore = await db().select().from(users);
    const entriesBefore = await db().select().from(auditLogEntries);
    const queue = recordingQueue();
    const result = await addMemberByEmail(
      db(),
      { workingGroupId, email, addedBy, now: new Date() },
      { queueMail: queue.queueMail },
    );
    expect(result).toEqual({ email, outcome: "invalid" });
    expect(await db().select().from(users)).toHaveLength(usersBefore.length);
    expect(await db().select().from(auditLogEntries)).toHaveLength(entriesBefore.length);
    expect(queue.jobs).toEqual([]);
  },
);

test("the same address from two people at the same moment gives one account, one membership and one mail", async () => {
  const { organizationId, workingGroupId, addedBy } = await setup();
  const admin = await userByEmail("beheer@example.test");
  const queue = recordingQueue();
  // Hold the group's lock, so both calls wait at it and then overlap every time.
  const held = await holdLock(db(), (tx) => lockWorkingGroup(tx, workingGroupId));
  const calls = Promise.all(
    [addedBy, admin!.id].map((by) =>
      addMemberByEmail(
        db(),
        { workingGroupId, email: "samen@example.test", addedBy: by, now: new Date() },
        { queueMail: queue.queueMail },
      ),
    ),
  );
  await waitUntilBlocked(db(), 2);
  await held.release();
  const results = await calls;
  expect(results.map((r) => r.outcome).sort()).toEqual(["added", "already_member"]);
  const accounts = await db().select().from(users).where(eq(users.email, "samen@example.test"));
  expect(accounts).toHaveLength(1);
  expect(await membershipsOf(accounts[0]!.id)).toHaveLength(1);
  expect(
    (await entriesAbout(accounts[0]!.id)).filter((e) => e.organizationId === organizationId),
  ).toHaveLength(1);
  expect(queue.jobs).toHaveLength(1);
});

test("two invitations of the same person at the same moment write one entry and queue one mail", async () => {
  const { workingGroupId, addedBy } = await setup();
  const admin = await userByEmail("beheer@example.test");
  const userId = await loggedInUser("bekend@example.test");
  const queue = recordingQueue();
  const held = await holdLock(db(), (tx) => lockWorkingGroup(tx, workingGroupId));
  const calls = Promise.all(
    [addedBy, admin!.id].map((by) =>
      addMemberByEmail(
        db(),
        { workingGroupId, email: "bekend@example.test", addedBy: by, now: new Date() },
        { queueMail: queue.queueMail },
      ),
    ),
  );
  await waitUntilBlocked(db(), 2);
  await held.release();
  const results = await calls;
  expect(results.map((r) => r.outcome)).toEqual(["invited", "invited"]);
  expect(await entriesAbout(userId)).toHaveLength(1);
  expect(queue.jobs).toHaveLength(1);
});

test("the same call twice: added, then already_member, and one mail in total", async () => {
  const { workingGroupId, addedBy } = await setup();
  const queue = recordingQueue();
  const outcomes: AddMemberOutcome[] = [];
  for (let i = 0; i < 2; i++) {
    const result = await addMemberByEmail(
      db(),
      { workingGroupId, email: "twee@example.test", addedBy, now: new Date() },
      { queueMail: queue.queueMail },
    );
    outcomes.push(result.outcome);
  }
  expect(outcomes).toEqual(["added", "already_member"]);
  expect(queue.jobs).toHaveLength(1);
});

test("adding to a working group that is switched off works", async () => {
  const { workingGroupId, addedBy } = await setup();
  await db().execute(sql`update working_groups set active = false where id = ${workingGroupId}`);
  const result = await addMemberByEmail(db(), {
    workingGroupId,
    email: "uit@example.test",
    addedBy,
    now: new Date(),
  });
  expect(result).toEqual({ email: "uit@example.test", outcome: "added" });
});

test("without a queue nothing is queued and the rest still happens", async () => {
  const { workingGroupId, addedBy } = await setup();
  const result = await addMemberByEmail(db(), {
    workingGroupId,
    email: "stil@example.test",
    addedBy,
    now: new Date(),
  });
  expect(result.outcome).toBe("added");
  const user = await userByEmail("stil@example.test");
  expect(await membershipsOf(user!.id)).toHaveLength(1);
});

test("normalizeEmailList trims, lowers, drops empty lines and counts doubles once", () => {
  expect(
    normalizeEmailList([
      " Jan@Example.test",
      "",
      "piet@example.test\r",
      "   ",
      "\tjan@example.test ",
      "JAN@EXAMPLE.TEST",
      "kees@",
    ]),
  ).toEqual(["jan@example.test", "piet@example.test", "kees@"]);
});

test("countAdditionsInLastDay counts added and invited of this actor, not approvals and not older ones", async () => {
  const { workingGroupId, otherWorkingGroupId, addedBy } = await setup();
  const admin = await userByEmail("beheer@example.test");
  const now = new Date();
  const add = (email: string, by = addedBy, group = workingGroupId) =>
    addMemberByEmail(db(), { workingGroupId: group, email, addedBy: by, now });
  expect(await countAdditionsInLastDay(db(), addedBy, now)).toBe(0);
  await add("een@example.test");
  await add("twee@example.test");
  await loggedInUser("bekend@example.test");
  await add("bekend@example.test");
  // Already a member, and invalid: no entry.
  await add("een@example.test");
  await add("jan@");
  // An approval is not counted.
  const applicant = await loggedInUser("aanmelder@example.test");
  await requestToJoin(applicant, otherWorkingGroupId);
  expect((await add("aanmelder@example.test", addedBy, otherWorkingGroupId)).outcome).toBe(
    "approved",
  );
  // Someone else's additions are not counted.
  await add("drie@example.test", admin!.id);
  expect(await countAdditionsInLastDay(db(), addedBy, now)).toBe(3);
  expect(await countAdditionsInLastDay(db(), admin!.id, now)).toBe(1);
  expect(await countAdditionsInLastDay(db(), addedBy, new Date(now.getTime() + 25 * HOUR))).toBe(0);
});
