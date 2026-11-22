import { and, eq, inArray, isNull } from "drizzle-orm";
import { hasOtherPlatformAdmin, lockPlatformAdmins } from "./admin";
import { recordAudit } from "./audit-log";
import type { Db } from "./client";
import { lockMembershipRequestsOfUser } from "./membership-requests";
import { notifyAccessChanged, notifyMembershipRequestsChanged } from "./notifications";
import {
  accounts,
  loginCodeRequests,
  membershipRequests,
  organizationAdmins,
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
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * Better Auth's email OTP plugin stores a code under `<type>-otp-<email>` (1.7.27,
 * `toOTPIdentifier`). We only let it make `sign-in` codes; the other types are removed as well,
 * in case one was ever stored.
 */
const OTP_TYPES = ["sign-in", "email-verification", "forget-password"] as const;

export type DeleteAccountResult = { outcome: "deleted" | "not_found" | "last_platform_admin" };

/**
 * The user deletes their own account (the design, "Deleting an account"). A soft delete, in one
 * transaction:
 *
 * 1. No such user, or already deleted: `not_found`. The user is a platform admin and no other
 *    platform admin who has logged in remains (`hasOtherPlatformAdmin`, the rule of
 *    `revokePlatformAdmin`): `last_platform_admin`, and nothing changes.
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
    // rows, then the user row. Every writer of the admin flag takes the first;
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
    const [user] = await tx
      .select({ email: users.email, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .for("update");
    if (!user) return { outcome: "not_found" };

    if (user.isPlatformAdmin && !(await hasOtherPlatformAdmin(tx, input.userId)))
      return { outcome: "last_platform_admin" };

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
