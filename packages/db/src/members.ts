import type { Member } from "@padvinder/contracts";
import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "./audit-log";
import type { Db } from "./client";
import { notifyAccessChanged } from "./notifications";
import { users, workingGroupMemberships, workingGroups } from "./schema";

/**
 * The members of a working group, sorted by name in Dutch order. With `contact: false` the query
 * does not select the email address and phone, and the objects have no such keys at all (not
 * `undefined`, not `null`). Whether the caller may see contact details is decided by the route.
 */
export async function listMembers(
  db: Db,
  workingGroupId: string,
  options: { contact: boolean },
): Promise<Member[]> {
  const order = [sql`${users.name} COLLATE "nl-NL-x-icu"`, workingGroupMemberships.id];
  const where = eq(workingGroupMemberships.workingGroupId, workingGroupId);
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
  return db
    .select({
      membershipId: workingGroupMemberships.id,
      userId: users.id,
      name: users.name,
      isCoordinator: workingGroupMemberships.isCoordinator,
      email: users.email,
      phone: users.phone,
    })
    .from(workingGroupMemberships)
    .innerJoin(users, eq(users.id, workingGroupMemberships.userId))
    .where(where)
    .orderBy(...order);
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

export type RemoveMembershipResult = {
  outcome: "removed" | "not_found" | "coordinator_changed";
};

/**
 * Removes a membership, with its audit entry (`membership.removed`, subject the user, details the
 * group and the role, `volunteer` or `coordinator`) and `access-changed` for the removed user, in
 * one transaction. May they? The caller decides that first, from the coordinator flag it loaded.
 *
 * The delete is one statement with `returning`: it locks the row, so two removals at once give one
 * `removed` and one `not_found`, and one audit entry. With `expectedIsCoordinator` it only deletes
 * a membership whose coordinator flag still has that value: if it changed in between (a volunteer
 * made coordinator) the row stays and the outcome is `coordinator_changed`, so the permission
 * decision made on the old flag is never applied to the new one.
 */
export async function removeMembership(
  db: Db,
  input: { membershipId: string; removedBy: string; expectedIsCoordinator?: boolean },
): Promise<RemoveMembershipResult> {
  return db.transaction(async (tx): Promise<RemoveMembershipResult> => {
    const conditions = [eq(workingGroupMemberships.id, input.membershipId)];
    if (input.expectedIsCoordinator !== undefined)
      conditions.push(eq(workingGroupMemberships.isCoordinator, input.expectedIsCoordinator));
    const [removed] = await tx
      .delete(workingGroupMemberships)
      .where(and(...conditions))
      .returning({
        userId: workingGroupMemberships.userId,
        isCoordinator: workingGroupMemberships.isCoordinator,
        workingGroupId: workingGroupMemberships.workingGroupId,
      });
    if (!removed) {
      if (input.expectedIsCoordinator === undefined) return { outcome: "not_found" };
      // Nothing matched the flag. Is the membership still there, with the other value?
      const [still] = await tx
        .select({ id: workingGroupMemberships.id })
        .from(workingGroupMemberships)
        .where(eq(workingGroupMemberships.id, input.membershipId));
      return { outcome: still ? "coordinator_changed" : "not_found" };
    }
    const [group] = await tx
      .select({ organizationId: workingGroups.organizationId })
      .from(workingGroups)
      .where(eq(workingGroups.id, removed.workingGroupId));
    await recordAudit(tx, {
      actor: { kind: "user", userId: input.removedBy },
      organizationId: group!.organizationId,
      action: "membership.removed",
      subject: { type: "user", id: removed.userId },
      details: {
        workingGroupId: removed.workingGroupId,
        role: removed.isCoordinator ? "coordinator" : "volunteer",
      },
    });
    await notifyAccessChanged(tx, removed.userId);
    return { outcome: "removed" };
  });
}
