import type { LiveEvent } from "@padvinder/contracts";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createOrganization, createWorkingGroup } from "./admin";
import { getMeRoles } from "./me";
import {
  createMembershipRequest,
  getCurrentMembershipRequest,
  MEMBERSHIP_REQUESTS_PER_DAY,
  withdrawMembershipRequest,
  type CreateMembershipRequestResult,
  type MembershipRequestRecord,
  type WithdrawMembershipRequestResult,
} from "./membership-requests";
import { liveEventsChannel, notify } from "./notifications";
import { membershipRequests, users, workingGroupMemberships, workingGroups } from "./schema";
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
  organizationId = (await createOrganization(db(), { name: organizationName }, system)).id;
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
