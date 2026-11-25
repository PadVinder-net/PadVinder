import type { Member } from "@padvinder/contracts";
import { and, eq, isNull, sql } from "drizzle-orm";
import { deleteAccount } from "./accounts";
import { countCoordinators, lockWorkingGroup } from "./admin";
import { recordAudit } from "./audit-log";
import type { Db } from "./client";
import { notifyAccessChanged } from "./notifications";
import { userHasLoggedIn } from "./users";
import { users, workingGroupMemberships, workingGroups } from "./schema";

/**
 * The members of a working group, sorted by name in Dutch order, without deleted accounts. With
 * `contact: false` the query does not select the email address and phone, and the objects have no
 * such keys at all (not `undefined`, not `null`). Whether the caller may see contact details is
 * decided by the route.
 */
export async function listMembers(
  db: Db,
  workingGroupId: string,
  options: { contact: boolean },
): Promise<Member[]> {
  const order = [sql`${users.name} COLLATE "nl-NL-x-icu"`, workingGroupMemberships.id];
  // A deleted account has no memberships (`deleteAccount` removes them); the filter is a guard
  // against one made at the same moment, for example by the admin tool.
  const where = and(
    eq(workingGroupMemberships.workingGroupId, workingGroupId),
    isNull(users.deletedAt),
  );
  if (!options.contact) {
    return db
      .select({
        membershipId: workingGroupMemberships.id,
        userId: users.id,
        name: users.name,
        isCoordinator: workingGroupMemberships.isCoordinator,
      })
      .from(workingGroupMemberships)
      .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
      .where(where)
      .orderBy(...order);
  }
  return selectMembersWithContact(db)
    .where(where)
    .orderBy(...order);
}

/** A member with the email address, phone and `hasLoggedIn`: for those who may see contact details. */
function selectMembersWithContact(db: Db) {
  return db
    .select({
      membershipId: workingGroupMemberships.id,
      userId: users.id,
      name: users.name,
      isCoordinator: workingGroupMemberships.isCoordinator,
      email: users.email,
      phone: users.phone,
      hasLoggedIn: userHasLoggedIn,
    })
    .from(workingGroupMemberships)
    .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
    .$dynamic();
}

/**
 * One member with contact details and `hasLoggedIn`; `null` when the membership is gone or its
 * account was deleted. Not scoped: the route decides whether the actor may see it.
 */
export async function getMember(db: Db, membershipId: string): Promise<Member | null> {
  const [row] = await selectMembersWithContact(db).where(
    and(eq(workingGroupMemberships.id, membershipId), isNull(users.deletedAt)),
  );
  return row ?? null;
}

/** The facts the permission check needs about one membership; `null` when it is gone. */
export async function getMembership(
  db: Db,
  membershipId: string,
): Promise<{
  membershipId: string;
  userId: string;
  isCoordinator: boolean;
  workingGroupId: string;
  organizationId: string;
} | null> {
  const [row] = await db
    .select({
      membershipId: workingGroupMemberships.id,
      userId: workingGroupMemberships.userId,
      isCoordinator: workingGroupMemberships.isCoordinator,
      workingGroupId: workingGroupMemberships.workingGroupId,
      organizationId: workingGroups.organizationId,
    })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .where(eq(workingGroupMemberships.id, membershipId));
  return row ?? null;
}

export type RemoveMembershipResult =
  /** `accountDeleted`: the removed person's account was deleted too (see `removeMembership`). */
  | { outcome: "removed"; accountDeleted: boolean }
  | { outcome: "not_found" | "coordinator_changed" | "last_coordinator" };

/**
 * Removes a membership, with its audit entry (`membership.removed`, subject the user, details the
 * group and the role, `volunteer` or `coordinator`) and `access-changed` for the removed user, in
 * one transaction. May they? The caller decides that first, from the coordinator flag it loaded.
 *
 * It takes the working group's lock (`lockWorkingGroup`) and reads the membership again under it,
 * so two removals at once give one `removed` and one `not_found`, and one audit entry. With
 * `expectedIsCoordinator` it only deletes a membership whose coordinator flag still has that
 * value: if it changed in between (a volunteer made coordinator) the row stays and the outcome is
 * `coordinator_changed`, so the permission decision made on the old flag is never applied to the
 * new one. The last coordinator of an active group stays: `last_coordinator`, and nothing changes.
 *
 * After the removal is committed, a removed person who never logged in is passed to
 * `deleteAccount` with `onlyIfUnused`, and `removedBy` as the actor of `account.deleted`: an
 * address added with a typing mistake does not stay behind. That is a second transaction, because
 * the first holds the working group's lock and `deleteAccount` takes its locks in another order
 * (the user's request lock before working groups). `deleteAccount` reads everything again under
 * its own locks, so a membership, a request or a login that came in between keeps the account.
 * The removal stands whatever the second step does: if it fails (a deadlock, a lost connection),
 * the error is not passed on and `accountDeleted` is false. An unused account left behind is
 * harmless, and the caller must not answer an error for a removal that was committed.
 */
export async function removeMembership(
  db: Db,
  input: { membershipId: string; removedBy: string; expectedIsCoordinator?: boolean },
): Promise<RemoveMembershipResult> {
  const result = await db.transaction(async (tx) => {
    const [found] = await tx
      .select({ workingGroupId: workingGroupMemberships.workingGroupId })
      .from(workingGroupMemberships)
      .where(eq(workingGroupMemberships.id, input.membershipId));
    if (!found) return { outcome: "not_found" as const };
    const group = await lockWorkingGroup(tx, found.workingGroupId);
    // Read again under the lock: a removal or role change that committed in between counts.
    const [membership] = await tx
      .select({
        userId: workingGroupMemberships.userId,
        isCoordinator: workingGroupMemberships.isCoordinator,
        hasLoggedIn: userHasLoggedIn,
      })
      .from(workingGroupMemberships)
      .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
      .where(eq(workingGroupMemberships.id, input.membershipId));
    if (!group || !membership) return { outcome: "not_found" as const };
    if (
      input.expectedIsCoordinator !== undefined &&
      membership.isCoordinator !== input.expectedIsCoordinator
    ) {
      return { outcome: "coordinator_changed" as const };
    }
    if (membership.isCoordinator && group.active) {
      const coordinators = await countCoordinators(tx, found.workingGroupId);
      if (coordinators < 2) return { outcome: "last_coordinator" as const };
    }
    await tx
      .delete(workingGroupMemberships)
      .where(eq(workingGroupMemberships.id, input.membershipId));
    await recordAudit(tx, {
      actor: { kind: "user", userId: input.removedBy },
      organizationId: group.organizationId,
      action: "membership.removed",
      subject: { type: "user", id: membership.userId },
      details: {
        workingGroupId: found.workingGroupId,
        role: membership.isCoordinator ? "coordinator" : "volunteer",
      },
    });
    await notifyAccessChanged(tx, membership.userId);
    return {
      outcome: "removed" as const,
      userId: membership.userId,
      hasLoggedIn: membership.hasLoggedIn,
    };
  });
  if (result.outcome !== "removed") return result;
  // Only an account that never logged in can be unused; skip the locks of `deleteAccount` else.
  if (result.hasLoggedIn) return { outcome: "removed", accountDeleted: false };
  const deletion = await deleteAccount(db, {
    userId: result.userId,
    now: new Date(),
    deletedBy: { kind: "user", userId: input.removedBy },
    onlyIfUnused: true,
  }).catch(() => null);
  return { outcome: "removed", accountDeleted: deletion?.outcome === "deleted" };
}
