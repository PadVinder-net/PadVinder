import type { LiveEvent } from "@padvinder/contracts";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
} from "./admin";
import { getMeRoles } from "./me";
import {
  createMembershipRequest,
  decideMembershipRequest,
  getCurrentMembershipRequest,
  getMembershipRequestForReview,
  listPendingMembershipRequests,
  listRequestNotificationRecipients,
  MEMBERSHIP_REQUESTS_PER_DAY,
  withdrawMembershipRequest,
  type CreateMembershipRequestResult,
  type MembershipRequestRecord,
  type WithdrawMembershipRequestResult,
} from "./membership-requests";
import { liveEventsChannel, notify } from "./notifications";
import {
  auditLogEntries,
  membershipRequests,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
const db = () => t!.db;
const system = { kind: "system" } as const;

let organizationId: string;
let organizationName: string;
/** Active groups, created once; each test uses fresh users. */
let groups: string[];

beforeAll(async () => {
  t = await createTestDatabase();
  organizationName = "Paddentrek Voorbeeldstad";
  organizationId = (
    await createOrganization(
      db(),
      { name: organizationName, adminEmail: "org-admin@example.test" },
      system,
    )
  ).id;
  groups = [];
  for (const name of ["Noord", "Zuid", "Oost", "West", "Centrum", "Dorp", "Haven"]) {
    groups.push(
      (await createWorkingGroup(db(), { organizationId, name, city: "Voorbeeldstad" }, system)).id,
    );
  }
});
afterAll(async () => {
  await t?.drop();
});

let userCount = 0;
async function newUser(): Promise<string> {
  const [row] = await db()
    .insert(users)
    .values({
      name: "Aanmelder",
      email: `aanmelder-${userCount++}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  return row!.id;
}

/** A UUIDv7 made the way the app makes one: the time in the first 48 bits, the rest random. */
function uuidv7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const requestedAt = new Date("2027-01-10T18:00:00Z");
const now = new Date("2027-01-10T18:00:05Z");

const create = (
  userId: string,
  workingGroupId: string,
  extra: { id?: string; now?: Date; requestedAt?: Date } = {},
) =>
  createMembershipRequest(db(), {
    id: extra.id ?? uuidv7(),
    userId,
    workingGroupId,
    requestedAt: extra.requestedAt ?? requestedAt,
    now: extra.now ?? now,
  });

/** The record of a result that has one; fails the test otherwise. */
function requestOf(
  result: CreateMembershipRequestResult | WithdrawMembershipRequestResult,
): MembershipRequestRecord {
  if (!("request" in result)) throw new Error(`Expected a request, got ${result.outcome}`);
  return result.request;
}

async function rowsOf(userId: string) {
  return db().select().from(membershipRequests).where(eq(membershipRequests.userId, userId));
}

const summary = (workingGroupId: string, name: string) => ({
  id: workingGroupId,
  name,
  city: "Voorbeeldstad",
  organization: { id: organizationId, name: organizationName },
});

/** Same pattern as in admin.test.ts: `drain()` returns what arrived before a marker. */
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
      const beatAt = new Date(Date.UTC(2027, 2, 1, 19, 30, markers++)).toISOString();
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

test("creates a pending request with the app's time and the server's time", async () => {
  const userId = await newUser();
  const id = uuidv7();
  const result = await create(userId, groups[0]!, { id });
  expect(result).toEqual({
    outcome: "created",
    request: {
      id,
      userId,
      status: "pending",
      requestedAt,
      receivedAt: now,
      decidedAt: null,
      workingGroup: summary(groups[0]!, "Noord"),
    },
  });
  const [row] = await rowsOf(userId);
  expect(row).toMatchObject({ id, status: "pending", requestedAt, receivedAt: now });
});

test("the same id from the same user gives the stored record and changes nothing", async () => {
  const userId = await newUser();
  const id = uuidv7();
  const first = await create(userId, groups[0]!, { id });
  const events = await listenForLiveEvents();
  try {
    // Even with another group and later times: the stored record is the answer.
    const again = await create(userId, groups[1]!, {
      id,
      now: new Date("2027-01-10T18:10:00Z"),
      requestedAt: new Date("2027-01-10T18:09:00Z"),
    });
    expect(again).toEqual({
      outcome: "existing",
      request: requestOf(first),
    });
    expect(await rowsOf(userId)).toHaveLength(1);
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
});

test("an id of someone else's request is id_in_use", async () => {
  const owner = await newUser();
  const other = await newUser();
  const id = uuidv7();
  await create(owner, groups[0]!, { id });
  expect(await create(other, groups[0]!, { id })).toEqual({ outcome: "id_in_use" });
  expect(await rowsOf(other)).toHaveLength(0);
});

test("an unknown or inactive working group is working_group_not_found", async () => {
  const userId = await newUser();
  expect(await create(userId, "0192f3c0-0000-7000-8000-00000000dead")).toEqual({
    outcome: "working_group_not_found",
  });
  const inactive = await createWorkingGroup(
    db(),
    { organizationId, name: "Opgeheven", city: "Voorbeeldstad" },
    system,
  );
  await db().update(workingGroups).set({ active: false }).where(eq(workingGroups.id, inactive.id));
  expect(await create(userId, inactive.id)).toEqual({ outcome: "working_group_not_found" });
  expect(await rowsOf(userId)).toHaveLength(0);
});

test("a member of the group, also a coordinator, is already_member", async () => {
  for (const isCoordinator of [false, true]) {
    const userId = await newUser();
    await db()
      .insert(workingGroupMemberships)
      .values({ userId, workingGroupId: groups[0]!, isCoordinator });
    expect(await create(userId, groups[0]!)).toEqual({ outcome: "already_member" });
    expect((await create(userId, groups[1]!)).outcome).toBe("created");
  }
});

test("a second pending request for the group is already_requested; another group is fine", async () => {
  const userId = await newUser();
  await create(userId, groups[0]!);
  expect(await create(userId, groups[0]!)).toEqual({ outcome: "already_requested" });
  expect((await create(userId, groups[1]!)).outcome).toBe("created");
  expect(await rowsOf(userId)).toHaveLength(2);
});

test("after a rejection or a withdrawal the user may ask again for the same group", async () => {
  const userId = await newUser();
  const first = await create(userId, groups[0]!);
  await db()
    .update(membershipRequests)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(membershipRequests.userId, userId));
  const second = await create(userId, groups[0]!);
  expect(second.outcome).toBe("created");
  expect(first.outcome).toBe("created");
  const id = requestOf(second).id;
  await withdrawMembershipRequest(db(), { id, userId, now });
  expect((await create(userId, groups[0]!)).outcome).toBe("created");
});

test(`at most ${MEMBERSHIP_REQUESTS_PER_DAY} new requests in 24 hours; a resend is not counted`, async () => {
  expect(MEMBERSHIP_REQUESTS_PER_DAY).toBe(5);
  const userId = await newUser();
  // One request just over 24 hours ago does not count.
  await create(userId, groups[6]!, { now: new Date(now.getTime() - 24 * 3600_000 - 1) });
  await withdrawMembershipRequest(db(), {
    id: (await rowsOf(userId))[0]!.id,
    userId,
    now,
  });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = uuidv7();
    ids.push(id);
    expect((await create(userId, groups[i]!, { id })).outcome).toBe("created");
    // Withdrawn requests count as well: asking and withdrawing must not get around the limit.
    if (i === 0) await withdrawMembershipRequest(db(), { id, userId, now });
  }
  expect(await create(userId, groups[5]!)).toEqual({ outcome: "too_many_requests" });
  // A resend of a stored id is answered as before, also over the limit.
  expect((await create(userId, groups[1]!, { id: ids[1] })).outcome).toBe("existing");
  expect(await rowsOf(userId)).toHaveLength(6);
  // A day after the oldest of the five, one is allowed again.
  const later = new Date(now.getTime() + 24 * 3600_000 + 1);
  expect((await create(userId, groups[5]!, { now: later })).outcome).toBe("created");
});

test("created sends membership-requests-changed and access-changed; refusals send nothing", async () => {
  const userId = await newUser();
  const events = await listenForLiveEvents();
  try {
    await create(userId, groups[0]!);
    expect(await events.drain()).toEqual([
      { type: "membership-requests-changed", workingGroupId: groups[0]!, organizationId },
      { type: "access-changed", userId },
    ]);
    expect((await create(userId, groups[0]!)).outcome).toBe("already_requested");
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
});

test("the same id sent twice at the same moment gives one created and one existing", async () => {
  const userId = await newUser();
  const id = uuidv7();
  const answers = await Promise.all([
    create(userId, groups[0]!, { id }),
    create(userId, groups[0]!, { id }),
  ]);
  expect(answers.map((a) => a.outcome).sort()).toEqual(["created", "existing"]);
  expect(await rowsOf(userId)).toHaveLength(1);
});

test("two new ids for one group at the same moment give one created and one already_requested", async () => {
  const userId = await newUser();
  const answers = await Promise.all([create(userId, groups[0]!), create(userId, groups[0]!)]);
  expect(answers.map((a) => a.outcome).sort()).toEqual(["already_requested", "created"]);
  expect(await rowsOf(userId)).toHaveLength(1);
});

test("at four requests, two at the same moment cannot both pass the limit", async () => {
  const userId = await newUser();
  for (let i = 0; i < 4; i++) await create(userId, groups[i]!);
  const answers = await Promise.all([create(userId, groups[4]!), create(userId, groups[5]!)]);
  expect(answers.map((a) => a.outcome).sort()).toEqual(["created", "too_many_requests"]);
  expect(await rowsOf(userId)).toHaveLength(5);
});

/**
 * Inserts a row in a transaction that stays open until `commit()`, and waits until another
 * connection is blocked on it. This makes the insert of `createMembershipRequest` hit a unique
 * violation after its checks passed, so the retry path is tested deterministically.
 */
async function holdUncommittedRow(row: typeof membershipRequests.$inferInsert) {
  let commit!: () => void;
  const released = new Promise<void>((resolve) => (commit = resolve));
  let inserted!: () => void;
  const ready = new Promise<void>((resolve) => (inserted = resolve));
  const done = db().transaction(async (tx) => {
    await tx.insert(membershipRequests).values(row);
    inserted();
    await released;
  });
  await ready;
  return {
    /** Throws when no connection ever waited on the row, so a test cannot pass without the race. */
    async commitWhenBlocked() {
      let sawBlocked = false;
      for (let i = 0; i < 100 && !sawBlocked; i++) {
        const [blocked] = await db()
          .execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'`,
          )
          .then((r) => r.rows);
        sawBlocked = blocked!.n > 0;
        if (!sawBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      commit();
      await done;
      if (!sawBlocked) throw new Error("No connection waited on the uncommitted row");
    },
  };
}

test("a concurrent insert of the same id is caught and the checks run again", async () => {
  const userId = await newUser();
  const other = await newUser();
  for (const [sender, expected] of [
    [userId, "existing"],
    [other, "id_in_use"],
  ] as const) {
    const id = uuidv7();
    const held = await holdUncommittedRow({
      id,
      userId,
      workingGroupId: groups[sender === userId ? 0 : 1]!,
      requestedAt,
      receivedAt: now,
    });
    const answer = create(sender, groups[2]!, { id });
    await held.commitWhenBlocked();
    expect((await answer).outcome).toBe(expected);
  }
  expect(await rowsOf(other)).toHaveLength(0);
  expect(await rowsOf(userId)).toHaveLength(2);
});

test("a concurrent pending request for the same group is caught as already_requested", async () => {
  const userId = await newUser();
  const held = await holdUncommittedRow({
    id: uuidv7(),
    userId,
    workingGroupId: groups[0]!,
    requestedAt,
    receivedAt: now,
  });
  const answer = create(userId, groups[0]!);
  await held.commitWhenBlocked();
  expect(await answer).toEqual({ outcome: "already_requested" });
  expect(await rowsOf(userId)).toHaveLength(1);
});

test("withdrawing sets withdrawn and decidedAt and sends both events; again is unchanged", async () => {
  const userId = await newUser();
  const id = uuidv7();
  await create(userId, groups[0]!, { id });
  const later = new Date("2027-01-11T08:00:00Z");
  const events = await listenForLiveEvents();
  try {
    const result = await withdrawMembershipRequest(db(), { id, userId, now: later });
    expect(result).toEqual({
      outcome: "withdrawn",
      request: {
        id,
        userId,
        status: "withdrawn",
        requestedAt,
        receivedAt: now,
        decidedAt: later,
        workingGroup: summary(groups[0]!, "Noord"),
      },
    });
    expect(await events.drain()).toEqual([
      { type: "membership-requests-changed", workingGroupId: groups[0]!, organizationId },
      { type: "access-changed", userId },
    ]);
    const again = await withdrawMembershipRequest(db(), {
      id,
      userId,
      now: new Date("2027-01-12T08:00:00Z"),
    });
    expect(again).toEqual({ outcome: "unchanged", request: requestOf(result) });
    expect(await events.drain()).toEqual([]);
  } finally {
    await events.close();
  }
});

test("someone else's or an unknown request is not_found; a decided one already_decided", async () => {
  const userId = await newUser();
  const other = await newUser();
  const id = uuidv7();
  await create(userId, groups[0]!, { id });
  expect(await withdrawMembershipRequest(db(), { id, userId: other, now })).toEqual({
    outcome: "not_found",
  });
  expect(await withdrawMembershipRequest(db(), { id: uuidv7(), userId, now })).toEqual({
    outcome: "not_found",
  });
  for (const status of ["approved", "rejected"] as const) {
    await db()
      .update(membershipRequests)
      .set({ status, decidedAt: now })
      .where(eq(membershipRequests.id, id));
    expect(await withdrawMembershipRequest(db(), { id, userId, now })).toEqual({
      outcome: "already_decided",
    });
  }
  expect((await rowsOf(userId))[0]!.status).toBe("rejected");
});

test("the current request is the newest pending one, else the newest when it is rejected", async () => {
  const userId = await newUser();
  expect(await getCurrentMembershipRequest(db(), userId)).toBeNull();

  const first = uuidv7();
  await create(userId, groups[0]!, { id: first });
  expect(await getCurrentMembershipRequest(db(), userId)).toMatchObject({
    id: first,
    status: "pending",
  });

  await db()
    .update(membershipRequests)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(membershipRequests.id, first));
  expect(await getCurrentMembershipRequest(db(), userId)).toMatchObject({
    id: first,
    status: "rejected",
  });

  // Newer by receivedAt wins, whatever the order of the ids.
  const newer = uuidv7();
  await create(userId, groups[1]!, { id: newer, now: new Date(now.getTime() + 1000) });
  expect(await getCurrentMembershipRequest(db(), userId)).toMatchObject({ id: newer });

  await withdrawMembershipRequest(db(), { id: newer, userId, now });
  expect(await getCurrentMembershipRequest(db(), userId)).toBeNull();
});

test("an older pending request wins over a newer withdrawn or rejected one", async () => {
  for (const status of ["withdrawn", "rejected"] as const) {
    const userId = await newUser();
    const older = uuidv7();
    await create(userId, groups[0]!, { id: older });
    const newer = uuidv7();
    await create(userId, groups[1]!, { id: newer, now: new Date(now.getTime() + 1000) });
    await db()
      .update(membershipRequests)
      .set({ status, decidedAt: now })
      .where(eq(membershipRequests.id, newer));
    expect(await getCurrentMembershipRequest(db(), userId), status).toMatchObject({
      id: older,
      status: "pending",
    });
  }
});

test("the newest of two pending requests wins; a rejection older than a withdrawal is not shown", async () => {
  const userId = await newUser();
  const first = uuidv7();
  await create(userId, groups[0]!, { id: first });
  const second = uuidv7();
  await create(userId, groups[1]!, { id: second, now: new Date(now.getTime() + 1000) });
  expect((await getCurrentMembershipRequest(db(), userId))?.id).toBe(second);
  await db()
    .update(membershipRequests)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(membershipRequests.id, first));
  await withdrawMembershipRequest(db(), { id: second, userId, now });
  expect(await getCurrentMembershipRequest(db(), userId)).toBeNull();
});

test("with the same receivedAt, the higher id is the newest", async () => {
  const userId = await newUser();
  const ids = [uuidv7(), uuidv7()].sort();
  await create(userId, groups[1]!, { id: ids[1] });
  await create(userId, groups[0]!, { id: ids[0] });
  expect((await getCurrentMembershipRequest(db(), userId))?.id).toBe(ids[1]);
});

test("getMeRoles has the current request, or null", async () => {
  const userId = await newUser();
  expect((await getMeRoles(db(), userId)).membershipRequest).toBeNull();
  const id = uuidv7();
  await create(userId, groups[0]!, { id });
  expect((await getMeRoles(db(), userId)).membershipRequest).toEqual({
    id,
    userId,
    status: "pending",
    requestedAt,
    receivedAt: now,
    decidedAt: null,
    workingGroup: summary(groups[0]!, "Noord"),
  });
});

// Reviewing: the coordinator's view of a request, and the decision.

const decidedAt = new Date("2027-01-12T08:30:00Z");

async function newApplicant(phone: string | null = "06 12345678") {
  const n = userCount++;
  const email = `aanvrager-${n}@example.test`;
  const [row] = await db()
    .insert(users)
    .values({ name: `Noor ${n}`, email, emailVerified: true, phone })
    .returning({ id: users.id });
  return { id: row!.id, name: `Noor ${n}`, email, phone };
}

/** A fresh group, so a list holds only the requests of the test. */
async function newGroup(name: string): Promise<string> {
  return (await createWorkingGroup(db(), { organizationId, name, city: "Voorbeeldstad" }, system))
    .id;
}

const decide = (id: string, decision: "approved" | "rejected", decidedBy: string, at = decidedAt) =>
  decideMembershipRequest(db(), { id, decision, decidedBy, now: at });

const membershipsOf = (userId: string) =>
  db().select().from(workingGroupMemberships).where(eq(workingGroupMemberships.userId, userId));

const auditOf = (requestId: string) =>
  db().select().from(auditLogEntries).where(eq(auditLogEntries.subjectId, requestId));

test("a request for review has the applicant's name, email address and phone number", async () => {
  const applicant = await newApplicant();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  expect(await getMembershipRequestForReview(db(), id)).toEqual({
    id,
    userId: applicant.id,
    status: "pending",
    requestedAt,
    receivedAt: now,
    decidedAt: null,
    workingGroup: summary(groups[0]!, "Noord"),
    organizationId,
    applicant,
  });
  expect(await getMembershipRequestForReview(db(), uuidv7())).toBeNull();
});

test("the pending list of a group holds only its pending requests, oldest first", async () => {
  const group = await newGroup("Lijst");
  const other = await newGroup("Lijst andere");
  const [a, b, c, d, e] = await Promise.all([1, 2, 3, 4, 5].map(() => newApplicant(null)));
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);
  const ids = { a: uuidv7(), b: uuidv7(), c: uuidv7(), d: uuidv7(), e: uuidv7() };
  await create(b!.id, group, { id: ids.b, now: at(2) });
  await create(a!.id, group, { id: ids.a, now: at(1) });
  await create(c!.id, group, { id: ids.c, now: at(3) });
  await create(d!.id, other, { id: ids.d, now: at(0) });
  await create(e!.id, group, { id: ids.e, now: at(0) });
  await withdrawMembershipRequest(db(), { id: ids.c, userId: c!.id, now: at(4) });
  await decide(ids.e, "rejected", a!.id);

  const list = await listPendingMembershipRequests(db(), group);
  expect(list.map((r) => r.id)).toEqual([ids.a, ids.b]);
  expect(list[0]).toMatchObject({ status: "pending", organizationId, applicant: a });
  expect(await listPendingMembershipRequests(db(), other)).toHaveLength(1);
  expect(await listPendingMembershipRequests(db(), "0192f3c0-0000-7000-8000-00000000dead")).toEqual(
    [],
  );
});

test("approving sets approved, adds a volunteer membership, one audit entry and both events", async () => {
  const applicant = await newApplicant();
  const reviewer = await newUser();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  const events = await listenForLiveEvents();
  try {
    const result = await decide(id, "approved", reviewer);
    expect(result).toEqual({
      outcome: "decided",
      request: {
        id,
        userId: applicant.id,
        status: "approved",
        requestedAt,
        receivedAt: now,
        decidedAt,
        workingGroup: summary(groups[0]!, "Noord"),
        organizationId,
        applicant,
      },
    });
    expect(await events.drain()).toEqual([
      { type: "membership-requests-changed", workingGroupId: groups[0]!, organizationId },
      { type: "access-changed", userId: applicant.id },
    ]);
  } finally {
    await events.close();
  }
  const [row] = await rowsOf(applicant.id);
  expect(row).toMatchObject({ status: "approved", decidedAt, decidedByUserId: reviewer });
  expect(await membershipsOf(applicant.id)).toMatchObject([
    { workingGroupId: groups[0]!, isCoordinator: false },
  ]);
  const entries = await auditOf(id);
  expect(entries).toMatchObject([
    {
      actorKind: "user",
      actorUserId: reviewer,
      organizationId,
      action: "membership_request.approved",
      subjectType: "membership_request",
      subjectId: id,
      details: { workingGroupId: groups[0]! },
    },
  ]);
  expect(JSON.stringify(entries)).not.toMatch(/example\.test|Noor|0612345678|06 1234/);
});

test("rejecting sets rejected, adds no membership, and writes one audit entry", async () => {
  const applicant = await newApplicant();
  const reviewer = await newUser();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  const result = await decide(id, "rejected", reviewer);
  expect(result).toMatchObject({ outcome: "decided", request: { status: "rejected", decidedAt } });
  expect(await membershipsOf(applicant.id)).toEqual([]);
  expect(await auditOf(id)).toMatchObject([
    { action: "membership_request.rejected", actorUserId: reviewer, organizationId },
  ]);
});

test("the same decision again is unchanged and writes nothing; the opposite is already_decided", async () => {
  for (const [decision, opposite] of [
    ["approved", "rejected"],
    ["rejected", "approved"],
  ] as const) {
    const applicant = await newApplicant();
    const reviewer = await newUser();
    const id = uuidv7();
    await create(applicant.id, groups[0]!, { id });
    const first = await decide(id, decision, reviewer);
    const events = await listenForLiveEvents();
    try {
      const again = await decide(id, decision, await newUser(), new Date("2027-01-13T08:00:00Z"));
      expect(again).toEqual({
        outcome: "unchanged",
        request: (first as { request: unknown }).request,
      });
      expect(await decide(id, opposite, reviewer)).toEqual({ outcome: "already_decided" });
      expect(await events.drain()).toEqual([]);
    } finally {
      await events.close();
    }
    expect(await auditOf(id)).toHaveLength(1);
    expect(await membershipsOf(applicant.id)).toHaveLength(decision === "approved" ? 1 : 0);
    expect((await rowsOf(applicant.id))[0]).toMatchObject({ status: decision, decidedAt });
  }
});

test("a withdrawn request is already_decided; an unknown one not_found", async () => {
  const applicant = await newApplicant();
  const reviewer = await newUser();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  await withdrawMembershipRequest(db(), { id, userId: applicant.id, now });
  for (const decision of ["approved", "rejected"] as const) {
    expect(await decide(id, decision, reviewer)).toEqual({ outcome: "already_decided" });
  }
  expect(await decide(uuidv7(), "approved", reviewer)).toEqual({ outcome: "not_found" });
  expect(await membershipsOf(applicant.id)).toEqual([]);
  expect(await auditOf(id)).toEqual([]);
});

test("approving someone who is a member already keeps their membership as it is", async () => {
  const applicant = await newApplicant();
  const reviewer = await newUser();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  // Made a coordinator through another way while the request was pending.
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: applicant.id, workingGroupId: groups[0]!, isCoordinator: true });
  expect((await decide(id, "approved", reviewer)).outcome).toBe("decided");
  expect(await membershipsOf(applicant.id)).toMatchObject([{ isCoordinator: true }]);
});

test("two opposite decisions at the same moment: one decided, one already_decided", async () => {
  for (let i = 0; i < 5; i++) {
    const applicant = await newApplicant();
    const reviewer = await newUser();
    const id = uuidv7();
    await create(applicant.id, groups[0]!, { id });
    const answers = await Promise.all([
      decide(id, "approved", reviewer),
      decide(id, "rejected", reviewer),
    ]);
    expect(answers.map((a) => a.outcome).sort()).toEqual(["already_decided", "decided"]);
    const won = answers.find((a) => a.outcome === "decided") as { request: { status: string } };
    expect(await membershipsOf(applicant.id)).toHaveLength(
      won.request.status === "approved" ? 1 : 0,
    );
    expect(await auditOf(id)).toHaveLength(1);
  }
});

test("withdrawing and approving at the same moment: exactly one wins", async () => {
  for (let i = 0; i < 5; i++) {
    const applicant = await newApplicant();
    const reviewer = await newUser();
    const id = uuidv7();
    await create(applicant.id, groups[0]!, { id });
    const [withdrawn, approved] = await Promise.all([
      withdrawMembershipRequest(db(), { id, userId: applicant.id, now }),
      decide(id, "approved", reviewer),
    ]);
    const [row] = await rowsOf(applicant.id);
    if (row!.status === "withdrawn") {
      expect([withdrawn.outcome, approved.outcome]).toEqual(["withdrawn", "already_decided"]);
      expect(await membershipsOf(applicant.id)).toEqual([]);
    } else {
      expect([withdrawn.outcome, approved.outcome]).toEqual(["already_decided", "decided"]);
      expect(await membershipsOf(applicant.id)).toHaveLength(1);
    }
  }
});

/**
 * Locks the request row in a transaction that stays open, changes its status there, and commits
 * only once another connection waits on the row. A call that reads the row without the lock
 * would see the old status and fail the test.
 */
async function holdRowAndSetStatus(id: string, status: "approved" | "withdrawn") {
  let commit!: () => void;
  const released = new Promise<void>((resolve) => (commit = resolve));
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => (locked = resolve));
  const done = db().transaction(async (tx) => {
    await tx.execute(sql`select id from membership_requests where id = ${id} for update`);
    await tx
      .update(membershipRequests)
      .set({ status, decidedAt: now })
      .where(eq(membershipRequests.id, id));
    locked();
    await released;
  });
  await ready;
  return {
    async commitWhenBlocked() {
      let sawBlocked = false;
      for (let i = 0; i < 100 && !sawBlocked; i++) {
        const [blocked] = await db()
          .execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'`,
          )
          .then((r) => r.rows);
        sawBlocked = blocked!.n > 0;
        if (!sawBlocked) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      commit();
      await done;
      if (!sawBlocked) throw new Error("No connection waited on the locked row");
    },
  };
}

test("a decision waits for a withdrawal that holds the row, then sees it", async () => {
  const applicant = await newApplicant();
  const reviewer = await newUser();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  const held = await holdRowAndSetStatus(id, "withdrawn");
  const answer = decide(id, "approved", reviewer);
  await held.commitWhenBlocked();
  expect(await answer).toEqual({ outcome: "already_decided" });
  expect(await membershipsOf(applicant.id)).toEqual([]);
  expect((await rowsOf(applicant.id))[0]!.status).toBe("withdrawn");
});

test("a withdrawal waits for a decision that holds the row, then sees it", async () => {
  const applicant = await newApplicant();
  const id = uuidv7();
  await create(applicant.id, groups[0]!, { id });
  const held = await holdRowAndSetStatus(id, "approved");
  const answer = withdrawMembershipRequest(db(), { id, userId: applicant.id, now });
  await held.commitWhenBlocked();
  expect(await answer).toEqual({ outcome: "already_decided" });
  expect((await rowsOf(applicant.id))[0]!.status).toBe("approved");
});

describe("listRequestNotificationRecipients", () => {
  const fresh = async (name: string) =>
    (await createWorkingGroup(db(), { organizationId, name, city: "Voorbeeldstad" }, system)).id;
  const person = async (email: string) => {
    await db().insert(users).values({ name: "Persoon", email, emailVerified: true });
    return email;
  };
  const markDeleted = (email: string) =>
    db().update(users).set({ deletedAt: new Date() }).where(eq(users.email, email));

  test("returns the coordinators of the group, not those of another group", async () => {
    const group = await fresh("Rec A");
    const other = await fresh("Rec B");
    await grantCoordinator(
      db(),
      { email: await person("rec-a1@example.test"), workingGroupId: group },
      system,
    );
    await grantCoordinator(
      db(),
      { email: await person("rec-a2@example.test"), workingGroupId: group },
      system,
    );
    await grantCoordinator(
      db(),
      { email: await person("rec-b1@example.test"), workingGroupId: other },
      system,
    );
    expect((await listRequestNotificationRecipients(db(), group)).sort()).toEqual([
      "rec-a1@example.test",
      "rec-a2@example.test",
    ]);
  });

  test("without a coordinator it returns the admins of the organization", async () => {
    const group = await fresh("Rec C");
    await grantOrganizationAdmin(
      db(),
      { email: await person("rec-admin@example.test"), organizationId },
      system,
    );
    const recipients = await listRequestNotificationRecipients(db(), group);
    expect(recipients).toContain("rec-admin@example.test");
  });

  test("with a coordinator it does not return the admins", async () => {
    const group = await fresh("Rec D");
    await grantCoordinator(
      db(),
      { email: await person("rec-d@example.test"), workingGroupId: group },
      system,
    );
    expect(await listRequestNotificationRecipients(db(), group)).toEqual(["rec-d@example.test"]);
  });

  test("never returns a deleted account; a group with only deleted coordinators falls back to the admins", async () => {
    const group = await fresh("Rec E");
    await grantCoordinator(
      db(),
      { email: await person("rec-e-gone@example.test"), workingGroupId: group },
      system,
    );
    // Marked deleted by hand, with the membership left: `deleteAccount` would remove it, and the
    // admin tool gives a deleted account no role.
    await markDeleted("rec-e-gone@example.test");
    const recipients = await listRequestNotificationRecipients(db(), group);
    expect(recipients).not.toContain("rec-e-gone@example.test");
    expect(recipients).toContain("rec-admin@example.test");

    const group2 = await fresh("Rec F");
    await grantCoordinator(
      db(),
      { email: await person("rec-f@example.test"), workingGroupId: group2 },
      system,
    );
    await grantCoordinator(
      db(),
      { email: await person("rec-f-gone@example.test"), workingGroupId: group2 },
      system,
    );
    await markDeleted("rec-f-gone@example.test");
    expect(await listRequestNotificationRecipients(db(), group2)).toEqual(["rec-f@example.test"]);
  });

  test("an unknown group has no recipients", async () => {
    expect(await listRequestNotificationRecipients(db(), uuidv7())).toEqual([]);
  });
});
