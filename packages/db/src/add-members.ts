import { emailAddressSchema } from "@padvinder/contracts";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  AdminError,
  findOrCreateUser,
  lockWorkingGroup,
  normalizeEmail,
  type AppointmentOptions,
} from "./admin";
import { recordAudit, type AuditAction } from "./audit-log";
import type { Db, DbTransaction } from "./client";
import {
  decideMembershipRequestInTransaction,
  lockMembershipRequestsOfUser,
  type MembershipRequestReviewRecord,
} from "./membership-requests";
import { notifyAccessChanged } from "./notifications";
import { auditLogEntries, membershipRequests, users, workingGroupMemberships } from "./schema";

/** What adding one address to a working group did (the design, "Adding by email address"). */
export type AddMemberOutcome = "added" | "approved" | "invited" | "already_member" | "invalid";

export type AddMemberResult = {
  /** The normalized address; for `invalid` the text as given. */
  email: string;
  outcome: AddMemberOutcome;
  /** For `approved`: the request that was approved, for the approval mail. */
  approvedRequest?: MembershipRequestReviewRecord;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `occurred_at` after `now - 24h`. There is deliberately no upper bound at `now`: `occurred_at`
 * is the database's time when the writing transaction started, `now` the API's time when the
 * request started. An entry that a request at the same moment committed after this request's
 * `now` (a double click, two coordinators with the same list) must count, or the person gets a
 * second invitation mail and the limit misses those additions.
 */
const inLastDay = (now: Date) => [gt(auditLogEntries.occurredAt, new Date(now.getTime() - DAY_MS))];

/** The entries that count as adding someone, for the limit per account per 24 hours. */
const ADDITION_ACTIONS: AuditAction[] = ["membership.added", "membership.invited"];

/**
 * Each address trimmed and lowercased, empty ones dropped, doubles once, in the order of first
 * appearance. Whether an address is valid is not checked here: `addMemberByEmail` answers
 * `invalid` for one that is not.
 */
export function normalizeEmailList(emails: string[]): string[] {
  const addresses = new Set<string>();
  for (const email of emails) {
    const address = normalizeEmail(email);
    if (address !== "") addresses.add(address);
  }
  return [...addresses];
}

/**
 * The entries `membership.added` and `membership.invited` that the user wrote in the 24 hours
 * before `now`: how many people they added or invited. Approvals do not count.
 */
export async function countAdditionsInLastDay(db: Db, userId: string, now: Date): Promise<number> {
  const [{ additions } = { additions: 0 }] = await db
    .select({ additions: count() })
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.actorUserId, userId),
        inArray(auditLogEntries.action, ADDITION_ACTIONS),
        ...inLastDay(now),
      ),
    );
  return additions;
}

/** The account with the address changed between the first read and `findOrCreateUser`. */
class AccountChanged extends Error {}

/** How often `addMemberByEmail` starts again after `AccountChanged`. */
const ATTEMPTS = 3;

/**
 * Adds the person with this address to the working group, in one transaction (the design,
 * "Adding by email address"). In this order:
 *
 * 1. Not an address by `emailAddressSchema` (which also refuses the address of a deleted
 *    account): `invalid`, and nothing is written.
 * 2. No account: one is made, with an empty name, and the person is added as in 6.
 * 3. Already a member of this group: `already_member`; nothing changes.
 * 4. The account has logged in before and has a pending request for this group: the request is
 *    approved, decided by `addedBy`, as `decideMembershipRequest` does: `approved`, with the
 *    request. No mail is queued; the caller sends the approval mail.
 * 5. The account has logged in before, without such a request: no membership, `invited`. Unless
 *    an entry `membership.invited` for this person and group was written in the 24 hours before
 *    `now`, one is written and the mail `invited-to-working-group` is queued.
 * 6. Otherwise (the account never logged in): a membership as a volunteer, the entry
 *    `membership.added`, `access-changed` for the person and the mail `added-to-working-group`:
 *    `added`.
 *
 * Both entries have the person as subject, the group's organization and details
 * `{ workingGroupId }`, never the address. The answer holds the address and the outcome, never a
 * name or a phone number of the person. A working group that is switched off is no obstacle; one
 * that does not exist is `working_group_not_found`. Without `queueMail` nothing is queued.
 *
 * Locks, in the order of `deleteAccount`: the request lock of the account with the address
 * (`lockMembershipRequestsOfUser`) and its pending request rows for this group, then the working
 * group (`lockWorkingGroup`), then the user row (`findOrCreateUser`, `for key share`). Two calls
 * for the same person, or for the same group, therefore run one after the other: the second sees
 * the membership or the invitation of the first, and nobody gets two accounts, two memberships or
 * two mails. When the account appeared or was replaced between the first read and
 * `findOrCreateUser` (someone else made it at the same moment), its request lock was not taken in
 * that order; the transaction is then rolled back and started again, and finds the account at
 * once.
 */
export async function addMemberByEmail(
  db: Db,
  input: { workingGroupId: string; email: string; addedBy: string; now: Date },
  options?: AppointmentOptions,
): Promise<AddMemberResult> {
  const parsed = emailAddressSchema.safeParse(input.email);
  if (!parsed.success) return { email: input.email, outcome: "invalid" };
  const email = parsed.data;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction((tx) => addInTransaction(tx, { ...input, email }, options));
    } catch (error) {
      if (!(error instanceof AccountChanged) || attempt >= ATTEMPTS) throw error;
    }
  }
}

async function addInTransaction(
  tx: DbTransaction,
  input: { workingGroupId: string; email: string; addedBy: string; now: Date },
  options: AppointmentOptions | undefined,
): Promise<AddMemberResult> {
  const { email, workingGroupId } = input;
  const [known] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)));
  if (known) {
    await lockMembershipRequestsOfUser(tx, known.id);
    await tx
      .select({ id: membershipRequests.id })
      .from(membershipRequests)
      .where(pendingRequest(known.id, workingGroupId))
      .for("update");
  }
  const group = await lockWorkingGroup(tx, workingGroupId);
  if (!group) throw new AdminError("working_group_not_found");
  const user = await findOrCreateUser(tx, email);
  // A new account is this transaction's own: nobody else can see it, so no lock is missing.
  if (!user.created && user.id !== known?.id) throw new AccountChanged();

  const [member] = await tx
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(
      and(
        eq(workingGroupMemberships.userId, user.id),
        eq(workingGroupMemberships.workingGroupId, workingGroupId),
      ),
    );
  if (member) return { email, outcome: "already_member" };

  const [account] = await tx
    .select({ lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.id, user.id));
  if (account?.lastLoginAt) {
    const [request] = await tx
      .select({ id: membershipRequests.id })
      .from(membershipRequests)
      .where(pendingRequest(user.id, workingGroupId));
    if (request) {
      const decided = await decideMembershipRequestInTransaction(tx, {
        id: request.id,
        decision: "approved",
        decidedBy: input.addedBy,
        now: input.now,
      });
      // The request row is locked since the start of this transaction, so it is still pending.
      if (decided.outcome !== "decided") {
        throw new Error(`A locked pending request was ${decided.outcome}`);
      }
      return { email, outcome: "approved", approvedRequest: decided.request };
    }
    if (!(await wasInvitedInLastDay(tx, user.id, workingGroupId, input.now))) {
      await recordAudit(tx, {
        actor: { kind: "user", userId: input.addedBy },
        organizationId: group.organizationId,
        action: "membership.invited",
        subject: { type: "user", id: user.id },
        details: { workingGroupId },
      });
      await options?.queueMail?.(tx, {
        kind: "invited-to-working-group",
        userId: user.id,
        workingGroupId,
        byUserId: input.addedBy,
      });
    }
    return { email, outcome: "invited" };
  }

  // A membership from an approval at the same moment (which takes no group lock) counts as one.
  const [membership] = await tx
    .insert(workingGroupMemberships)
    .values({ userId: user.id, workingGroupId, isCoordinator: false })
    .onConflictDoNothing({
      target: [workingGroupMemberships.userId, workingGroupMemberships.workingGroupId],
    })
    .returning({ id: workingGroupMemberships.id });
  if (!membership) return { email, outcome: "already_member" };
  await recordAudit(tx, {
    actor: { kind: "user", userId: input.addedBy },
    organizationId: group.organizationId,
    action: "membership.added",
    subject: { type: "user", id: user.id },
    details: { workingGroupId },
  });
  await notifyAccessChanged(tx, user.id);
  await options?.queueMail?.(tx, {
    kind: "added-to-working-group",
    membershipId: membership.id,
    byUserId: input.addedBy,
  });
  return { email, outcome: "added" };
}

const pendingRequest = (userId: string, workingGroupId: string) =>
  and(
    eq(membershipRequests.userId, userId),
    eq(membershipRequests.workingGroupId, workingGroupId),
    eq(membershipRequests.status, "pending"),
  );

/** Whether an entry `membership.invited` for this person and group was written in the last day. */
async function wasInvitedInLastDay(
  tx: DbTransaction,
  userId: string,
  workingGroupId: string,
  now: Date,
): Promise<boolean> {
  const [entry] = await tx
    .select({ id: auditLogEntries.id })
    .from(auditLogEntries)
    .where(
      and(
        eq(auditLogEntries.subjectType, "user"),
        eq(auditLogEntries.subjectId, userId),
        eq(auditLogEntries.action, "membership.invited"),
        sql`${auditLogEntries.details}->>'workingGroupId' = ${workingGroupId}`,
        ...inLastDay(now),
      ),
    )
    .limit(1);
  return entry !== undefined;
}
