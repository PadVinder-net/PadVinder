import { DELETED_ACCOUNT_EMAIL_DOMAIN, type AccountDeletionBlocker } from "@padvinder/contracts";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  countCoordinators,
  countOrganizationAdmins,
  hasOtherPlatformAdmin,
  lockOrganization,
  lockPlatformAdmins,
  lockWorkingGroup,
} from "./admin";
import { recordAudit } from "./audit-log";
import type { Db, DbTransaction } from "./client";
import { lockMembershipRequestsOfUser } from "./membership-requests";
import { notifyAccessChanged, notifyMembershipRequestsChanged } from "./notifications";
import {
  accounts,
  loginCodeRequests,
  membershipRequests,
  organizationAdmins,
  organizations,
  sessions,
  users,
  verifications,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

/** Shown wherever the name of a deleted account would appear. */
export const DELETED_ACCOUNT_NAME = "Verwijderd account";

/**
 * The address a deleted account gets in place of its own: unique (the id is), never shown, and
 * undeliverable (`.invalid` is reserved, RFC 2606). The old address is free for a new account.
 */
export function deletedAccountEmail(userId: string): string {
  return `deleted-${userId}@${DELETED_ACCOUNT_EMAIL_DOMAIN}`;
}

/**
 * Better Auth's email OTP plugin stores a code under `<type>-otp-<email>` (1.7.27,
 * `toOTPIdentifier`). We only let it make `sign-in` codes; the other types are removed as well,
 * in case one was ever stored.
 */
const OTP_TYPES = ["sign-in", "email-verification", "forget-password"] as const;

export type DeleteAccountResult =
  | { outcome: "deleted" | "not_found" | "last_platform_admin" }
  | { outcome: "blocked"; blockers: AccountDeletionBlocker[] };

const dutch = (column: Parameters<typeof asc>[0]) => sql`${column} COLLATE "nl-NL-x-icu"`;

/** The locks `deleteAccount` holds on the organizations and working groups of the user. */
type HeldLocks = { organizationIds: Set<string>; workingGroupIds: Set<string> };

/**
 * Locks the organizations the user administers, then the working groups the user is a member of,
 * each in the order of their IDs, skipping those in `held`. Every function that removes an admin
 * row or a membership, or clears the coordinator flag, takes the same lock first, so none of them
 * can change the count between `findBlockers` and the commit.
 */
async function lockRolesOfUser(tx: DbTransaction, userId: string, held: HeldLocks) {
  const adminRows = await tx
    .select({ organizationId: organizationAdmins.organizationId })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.userId, userId));
  const membershipRows = await tx
    .select({ workingGroupId: workingGroupMemberships.workingGroupId })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.userId, userId));
  const organizationIds = adminRows.map((row) => row.organizationId);
  const workingGroupIds = membershipRows.map((row) => row.workingGroupId);
  for (const id of [...new Set(organizationIds)]
    .filter((id) => !held.organizationIds.has(id))
    .sort()) {
    await lockOrganization(tx, id);
    held.organizationIds.add(id);
  }
  for (const id of [...new Set(workingGroupIds)]
    .filter((id) => !held.workingGroupIds.has(id))
    .sort()) {
    await lockWorkingGroup(tx, id);
    held.workingGroupIds.add(id);
  }
}

/**
 * One blocker per active working group the user is the only coordinator of, then one per
 * organization the user is the only admin of; each sorted by name in Dutch order. Read under the
 * locks of `lockRolesOfUser`. A coordinator or admin who never logged in counts.
 */
async function findBlockers(tx: DbTransaction, userId: string): Promise<AccountDeletionBlocker[]> {
  const coordinated = await tx
    .select({ workingGroupId: workingGroupMemberships.workingGroupId })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .where(
      and(
        eq(workingGroupMemberships.userId, userId),
        eq(workingGroupMemberships.isCoordinator, true),
        eq(workingGroups.active, true),
      ),
    );
  const onlyCoordinatorOf: string[] = [];
  for (const { workingGroupId } of coordinated) {
    if ((await countCoordinators(tx, workingGroupId)) < 2) onlyCoordinatorOf.push(workingGroupId);
  }
  const administered = await tx
    .select({ organizationId: organizationAdmins.organizationId })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.userId, userId));
  const onlyAdminOf: string[] = [];
  for (const { organizationId } of administered) {
    if ((await countOrganizationAdmins(tx, organizationId)) < 2) onlyAdminOf.push(organizationId);
  }

  const groupBlockers =
    onlyCoordinatorOf.length === 0
      ? []
      : await tx
          .select({
            workingGroupName: workingGroups.name,
            organizationName: organizations.name,
            contactEmail: organizations.contactEmail,
          })
          .from(workingGroups)
          .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
          .where(inArray(workingGroups.id, onlyCoordinatorOf))
          .orderBy(dutch(workingGroups.name), dutch(organizations.name), asc(workingGroups.id));
  const organizationBlockers =
    onlyAdminOf.length === 0
      ? []
      : await tx
          .select({
            organizationName: organizations.name,
            contactEmail: organizations.contactEmail,
          })
          .from(organizations)
          .where(inArray(organizations.id, onlyAdminOf))
          .orderBy(dutch(organizations.name), asc(organizations.id));
  return [
    ...groupBlockers.map((row) => ({ role: "coordinator" as const, ...row })),
    ...organizationBlockers.map((row) => ({
      role: "organizationAdmin" as const,
      workingGroupName: null,
      ...row,
    })),
  ];
}

/**
 * The user deletes their own account (the design, "Deleting an account"). A soft delete, in one
 * transaction:
 *
 * 1. No such user, or already deleted: `not_found`. The user is a platform admin and no other
 *    platform admin who has logged in remains (`hasOtherPlatformAdmin`, the rule of
 *    `revokePlatformAdmin`): `last_platform_admin`, and nothing changes. The user is the only
 *    coordinator of an active working group, or the only admin of an organization: `blocked`,
 *    with every such group and organization (`findBlockers`), and nothing changes.
 * 2. The personal fields are wiped: the name becomes `DELETED_ACCOUNT_NAME`, the address
 *    `deletedAccountEmail(id)`; phone and image are emptied; the platform admin flag is removed;
 *    `deleted_at` is set.
 * 3. Better Auth's rows for the user go: sessions, account rows, and the login codes and code
 *    requests of the old address.
 * 4. Their pending membership requests are withdrawn (with `membership-requests-changed` for each
 *    group), and their memberships and organization admin rows are deleted.
 * 5. One audit entry (actor and subject the user, no details) and `access-changed` for the user,
 *    which ends their open event streams.
 *
 * The `users` row stays, and so does everything that points at it: decided requests now, rounds
 * and drain checks later. It cannot be undone; the same address logs in later as a new account.
 */
export async function deleteAccount(
  db: Db,
  input: { userId: string; now: Date },
): Promise<DeleteAccountResult> {
  return db.transaction(async (tx): Promise<DeleteAccountResult> => {
    // Lock order: the platform admin lock, the user's request lock, the user's pending request
    // rows, the organizations the user administers and the working groups the user is a member
    // of (each in the order of their IDs, as every other taker of these locks), then the user
    // row. Every writer of the admin flag takes the first;
    // `createMembershipRequest` takes the second, so no request of this user can slip in after the
    // withdrawal below. The request rows come before the user row because a decision locks its
    // request row first and then, inserting the membership, takes a share lock on the user row
    // (the foreign key): the other order deadlocks. Here a decision that holds a request row
    // finishes first (the row then no longer matches `pending`); a decision that comes later waits
    // for this transaction and then finds the request withdrawn.
    await lockPlatformAdmins(tx);
    await lockMembershipRequestsOfUser(tx, input.userId);
    await tx
      .select({ id: membershipRequests.id })
      .from(membershipRequests)
      .where(
        and(eq(membershipRequests.userId, input.userId), eq(membershipRequests.status, "pending")),
      )
      .for("update");
    const held: HeldLocks = { organizationIds: new Set(), workingGroupIds: new Set() };
    await lockRolesOfUser(tx, input.userId, held);
    const [user] = await tx
      .select({ email: users.email, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .for("update");
    if (!user) return { outcome: "not_found" };
    // Read the memberships and admin rows again. A role given between the first read and the
    // user row lock is locked now, after the user row: out of the usual order (group and
    // organization locks before user rows). The role's writer has committed, but another
    // transaction can hold that group's or organization's lock and wait for this user row:
    // `setCoordinator`, `updateWorkingGroup` and `removeAdminRow` take the lock first and then
    // write an audit entry, whose `actor_user_id` (a foreign key) takes a key share lock on the
    // actor's user row. If this user is that actor at that moment, in a group or organization that
    // became theirs between the two reads, the two transactions deadlock. PostgreSQL detects it
    // and aborts one of them (that request answers 500); nothing is half written. Narrow enough to
    // accept.
    //
    // After the user row lock no role can be added for this account. Every function that gives a
    // role by address finds the account with `findOrCreateUser`. One that reached the row before
    // the update below holds it `for key share`, so it either committed before this lock or waits
    // for this transaction and then no longer finds the address (`user_not_found`). One whose
    // insert comes after the update below waits for this transaction too, and then makes a new
    // account at the freed address: correct, because the same address later is a new account and
    // the deleted one gets no role. A foreign key check alone would not stop the first case: it
    // waits for this transaction, then accepts the row, whose id has not changed. A membership
    // from an approved request is covered by the request row locks above.
    await lockRolesOfUser(tx, input.userId, held);

    if (user.isPlatformAdmin && !(await hasOtherPlatformAdmin(tx, input.userId)))
      return { outcome: "last_platform_admin" };
    const blockers = await findBlockers(tx, input.userId);
    if (blockers.length > 0) return { outcome: "blocked", blockers };

    await tx
      .update(users)
      .set({
        name: DELETED_ACCOUNT_NAME,
        email: deletedAccountEmail(input.userId),
        phone: null,
        image: null,
        emailVerified: false,
        isPlatformAdmin: false,
        deletedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(users.id, input.userId));

    await tx.delete(sessions).where(eq(sessions.userId, input.userId));
    await tx.delete(accounts).where(eq(accounts.userId, input.userId));
    await tx.delete(verifications).where(
      inArray(
        verifications.identifier,
        OTP_TYPES.map((type) => `${type}-otp-${user.email}`),
      ),
    );
    await tx.delete(loginCodeRequests).where(eq(loginCodeRequests.email, user.email));

    // The pending rows are locked since the start; a decision that approved one of them before
    // that has committed its membership, so the delete below removes it.
    const withdrawn = await tx
      .update(membershipRequests)
      .set({ status: "withdrawn", decidedAt: input.now })
      .where(
        and(eq(membershipRequests.userId, input.userId), eq(membershipRequests.status, "pending")),
      )
      .returning({ workingGroupId: membershipRequests.workingGroupId });
    const groupIds = [...new Set(withdrawn.map((row) => row.workingGroupId))];
    if (groupIds.length > 0) {
      const groups = await tx
        .select({ id: workingGroups.id, organizationId: workingGroups.organizationId })
        .from(workingGroups)
        .where(inArray(workingGroups.id, groupIds))
        .orderBy(workingGroups.id);
      for (const group of groups) {
        await notifyMembershipRequestsChanged(tx, {
          workingGroupId: group.id,
          organizationId: group.organizationId,
        });
      }
    }
    await tx
      .delete(workingGroupMemberships)
      .where(eq(workingGroupMemberships.userId, input.userId));
    await tx.delete(organizationAdmins).where(eq(organizationAdmins.userId, input.userId));

    await recordAudit(tx, {
      actor: { kind: "user", userId: input.userId },
      organizationId: null,
      action: "account.deleted",
      subject: { type: "user", id: input.userId },
    });
    await notifyAccessChanged(tx, input.userId);
    return { outcome: "deleted" };
  });
}
