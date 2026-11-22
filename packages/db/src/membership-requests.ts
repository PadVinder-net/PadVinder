import type { MembershipRequestStatus, WorkingGroupSummary } from "@padvinder/contracts";
import { and, count, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import type { Db, DbTransaction } from "./client";
import { notifyAccessChanged, notifyMembershipRequestsChanged } from "./notifications";
import {
  membershipRequests,
  organizations,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

/** A user creates at most this many requests in 24 hours (spec: one account must not be able to mail every coordinator again and again). */
export const MEMBERSHIP_REQUESTS_PER_DAY = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

// The first key of the two-key advisory lock: a fixed number for "membership requests of one
// user". Login codes use 7_310_001; pg-boss uses the one-key space.
const LOCK_CLASS = 7_310_002;

export type MembershipRequestRecord = {
  id: string;
  userId: string;
  status: MembershipRequestStatus;
  /** When the user acted, by the app's clock. */
  requestedAt: Date;
  /** When the server received it. The 24-hour limit and "newest" go by this time. */
  receivedAt: Date;
  /** When it was approved, rejected or withdrawn. */
  decidedAt: Date | null;
  workingGroup: WorkingGroupSummary;
};

export type CreateMembershipRequestResult =
  | { outcome: "created" | "existing"; request: MembershipRequestRecord }
  | {
      outcome:
        | "id_in_use"
        | "working_group_not_found"
        | "already_member"
        | "already_requested"
        | "too_many_requests";
    };

export type WithdrawMembershipRequestResult =
  | { outcome: "withdrawn" | "unchanged"; request: MembershipRequestRecord }
  | { outcome: "not_found" | "already_decided" };

/** The requests with their working group and organization, filtered by `where`, newest first. */
async function selectRequests(
  db: Db | DbTransaction,
  where: SQL | undefined,
  options: { limit?: number; forUpdate?: boolean } = {},
): Promise<(MembershipRequestRecord & { organizationId: string })[]> {
  let query = db
    .select({
      id: membershipRequests.id,
      userId: membershipRequests.userId,
      status: membershipRequests.status,
      requestedAt: membershipRequests.requestedAt,
      receivedAt: membershipRequests.receivedAt,
      decidedAt: membershipRequests.decidedAt,
      groupId: workingGroups.id,
      groupName: workingGroups.name,
      city: workingGroups.city,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(membershipRequests)
    .innerJoin(workingGroups, eq(workingGroups.id, membershipRequests.workingGroupId))
    .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
    .where(where)
    // The id breaks a tie: two requests that arrived in the same microsecond.
    .orderBy(desc(membershipRequests.receivedAt), desc(membershipRequests.id))
    .$dynamic();
  if (options.limit !== undefined) query = query.limit(options.limit);
  // Locks the request row only; the working group and organization stay free.
  if (options.forUpdate) query = query.for("update", { of: membershipRequests });
  const rows = await query;
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    status: row.status,
    requestedAt: row.requestedAt,
    receivedAt: row.receivedAt,
    decidedAt: row.decidedAt,
    organizationId: row.organizationId,
    workingGroup: {
      id: row.groupId,
      name: row.groupName,
      city: row.city,
      organization: { id: row.organizationId, name: row.organizationName },
    },
  }));
}

function withoutOrganizationId({
  organizationId: _organizationId,
  ...request
}: MembershipRequestRecord & { organizationId: string }): MembershipRequestRecord {
  return request;
}

/** True for PostgreSQL's unique_violation (23505), also when Drizzle wrapped it in a cause. */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth++) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Asks to join a working group for the user, idempotently: `id` comes from the app and is the
 * same on every resend. The checks run in this order, in one transaction:
 *
 * 1. A request with this `id` exists: `existing` for the same user (changes nothing, sends
 *    nothing), `id_in_use` for another user.
 * 2. The working group is missing or not active: `working_group_not_found`.
 * 3. The user is a member of the group: `already_member`.
 * 4. The user has a pending request for the group: `already_requested`.
 * 5. The user created `MEMBERSHIP_REQUESTS_PER_DAY` requests in the 24 hours before `now`:
 *    `too_many_requests`. Resends never insert, so they are never counted.
 * 6. Inserts it with `received_at = now`, sends both live events: `created`.
 *
 * A lock per user serializes the requests of one user, so two at the same moment cannot both
 * pass the count or the pending check. An insert can still meet a row that another transaction
 * committed after the checks (the same `id` from another user, or a row written without the
 * lock); the unique violation is caught and the checks run once more in a new transaction.
 */
export async function createMembershipRequest(
  db: Db,
  input: { id: string; userId: string; workingGroupId: string; requestedAt: Date; now: Date },
): Promise<CreateMembershipRequestResult> {
  try {
    return await tryCreateMembershipRequest(db, input);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return tryCreateMembershipRequest(db, input);
  }
}

function tryCreateMembershipRequest(
  db: Db,
  input: { id: string; userId: string; workingGroupId: string; requestedAt: Date; now: Date },
): Promise<CreateMembershipRequestResult> {
  return db.transaction(async (tx): Promise<CreateMembershipRequestResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_CLASS}, hashtext(${input.userId}))`);

    const [stored] = await selectRequests(tx, eq(membershipRequests.id, input.id));
    if (stored) {
      if (stored.userId !== input.userId) return { outcome: "id_in_use" };
      return { outcome: "existing", request: withoutOrganizationId(stored) };
    }

    const [group] = await tx
      .select({ organizationId: workingGroups.organizationId })
      .from(workingGroups)
      .where(and(eq(workingGroups.id, input.workingGroupId), eq(workingGroups.active, true)));
    if (!group) return { outcome: "working_group_not_found" };

    const [membership] = await tx
      .select({ id: workingGroupMemberships.id })
      .from(workingGroupMemberships)
      .where(
        and(
          eq(workingGroupMemberships.userId, input.userId),
          eq(workingGroupMemberships.workingGroupId, input.workingGroupId),
        ),
      );
    if (membership) return { outcome: "already_member" };

    const [pending] = await tx
      .select({ id: membershipRequests.id })
      .from(membershipRequests)
      .where(
        and(
          eq(membershipRequests.userId, input.userId),
          eq(membershipRequests.workingGroupId, input.workingGroupId),
          eq(membershipRequests.status, "pending"),
        ),
      );
    if (pending) return { outcome: "already_requested" };

    const [recent] = await tx
      .select({ n: count() })
      .from(membershipRequests)
      .where(
        and(
          eq(membershipRequests.userId, input.userId),
          gte(membershipRequests.receivedAt, new Date(input.now.getTime() - DAY_MS)),
        ),
      );
    if ((recent?.n ?? 0) >= MEMBERSHIP_REQUESTS_PER_DAY) return { outcome: "too_many_requests" };

    await tx.insert(membershipRequests).values({
      id: input.id,
      userId: input.userId,
      workingGroupId: input.workingGroupId,
      status: "pending",
      requestedAt: input.requestedAt,
      receivedAt: input.now,
    });
    await notifyMembershipRequestsChanged(tx, {
      workingGroupId: input.workingGroupId,
      organizationId: group.organizationId,
    });
    await notifyAccessChanged(tx, input.userId);

    const [created] = await selectRequests(tx, eq(membershipRequests.id, input.id));
    return { outcome: "created", request: withoutOrganizationId(created!) };
  });
}

/**
 * The applicant withdraws their own pending request. Withdrawing a withdrawn request again is
 * `unchanged`; an approved or rejected one is `already_decided`; a request of someone else is
 * `not_found`, as if it did not exist. No audit entry: it is the person's own act.
 */
export async function withdrawMembershipRequest(
  db: Db,
  input: { id: string; userId: string; now: Date },
): Promise<WithdrawMembershipRequestResult> {
  return db.transaction(async (tx): Promise<WithdrawMembershipRequestResult> => {
    const [stored] = await selectRequests(tx, eq(membershipRequests.id, input.id), {
      forUpdate: true,
    });
    if (!stored || stored.userId !== input.userId) return { outcome: "not_found" };
    if (stored.status === "withdrawn") {
      return { outcome: "unchanged", request: withoutOrganizationId(stored) };
    }
    if (stored.status !== "pending") return { outcome: "already_decided" };

    await tx
      .update(membershipRequests)
      .set({ status: "withdrawn", decidedAt: input.now })
      .where(eq(membershipRequests.id, input.id));
    await notifyMembershipRequestsChanged(tx, {
      workingGroupId: stored.workingGroup.id,
      organizationId: stored.organizationId,
    });
    await notifyAccessChanged(tx, input.userId);
    return {
      outcome: "withdrawn",
      request: { ...withoutOrganizationId(stored), status: "withdrawn", decidedAt: input.now },
    };
  });
}

/**
 * The request `/api/me` shows: the user's newest request (by `received_at`, then `id`) when it
 * is pending or rejected, otherwise `null`.
 */
export async function getCurrentMembershipRequest(
  db: Db | DbTransaction,
  userId: string,
): Promise<MembershipRequestRecord | null> {
  const [newest] = await selectRequests(db, eq(membershipRequests.userId, userId), { limit: 1 });
  if (!newest || (newest.status !== "pending" && newest.status !== "rejected")) return null;
  return withoutOrganizationId(newest);
}
