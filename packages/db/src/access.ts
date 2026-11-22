import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./client";
import { organizationAdmins, users, workingGroupMemberships, workingGroups } from "./schema";

export type Access = {
  isPlatformAdmin: boolean;
  memberships: {
    membershipId: string;
    workingGroupId: string;
    organizationId: string;
    isCoordinator: boolean;
  }[];
  adminOfOrganizationIds: string[];
};

/**
 * What a user may be, read from the database. `null` when the user does not exist or deleted
 * their account (a session made in the moment of the deletion never becomes an actor).
 * Memberships of inactive working groups are left out.
 */
export async function getAccess(db: Db, userId: string): Promise<Access | null> {
  const [user] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  if (!user) return null;
  const memberships = await db
    .select({
      membershipId: workingGroupMemberships.id,
      workingGroupId: workingGroupMemberships.workingGroupId,
      organizationId: workingGroups.organizationId,
      isCoordinator: workingGroupMemberships.isCoordinator,
    })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .where(and(eq(workingGroupMemberships.userId, userId), eq(workingGroups.active, true)));
  const admins = await db
    .select({ organizationId: organizationAdmins.organizationId })
    .from(organizationAdmins)
    .where(eq(organizationAdmins.userId, userId));
  return {
    isPlatformAdmin: user.isPlatformAdmin,
    memberships,
    adminOfOrganizationIds: admins.map((row) => row.organizationId),
  };
}
