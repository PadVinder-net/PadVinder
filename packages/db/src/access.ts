import type { MembershipRole } from "@padvinder/contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { organizationAdmins, users, workingGroupMemberships, workingGroups } from "./schema";

export type { MembershipRole };

export type Access = {
  isPlatformAdmin: boolean;
  memberships: {
    membershipId: string;
    workingGroupId: string;
    organizationId: string;
    role: MembershipRole;
  }[];
  adminOfOrganizationIds: string[];
};

/**
 * What a user may be, read from the database. `null` when the user does not exist.
 * Memberships of inactive working groups are left out.
 */
export async function getAccess(db: Db, userId: string): Promise<Access | null> {
  const [user] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const memberships = await db
    .select({
      membershipId: workingGroupMemberships.id,
      workingGroupId: workingGroupMemberships.workingGroupId,
      organizationId: workingGroups.organizationId,
      role: workingGroupMemberships.role,
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
