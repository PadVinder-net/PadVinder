import { and, asc, eq, sql, type AnyColumn } from "drizzle-orm";
import type { Db } from "./client";
import type { MembershipRole } from "./access";
import { getUserProfile, type UserProfile } from "./users";
import {
  organizationAdmins,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

export type MeDetails = {
  user: UserProfile & { isPlatformAdmin: boolean };
  memberships: {
    id: string;
    role: MembershipRole;
    workingGroup: {
      id: string;
      name: string;
      city: string;
      organization: { id: string; name: string };
    };
  }[];
  organizationAdminOf: { id: string; name: string }[];
};

const dutch = (column: AnyColumn) => sql`${column} collate "nl-NL-x-icu"`;

/**
 * The user with their memberships and administrator rights, for `/api/me`. `null` when the user
 * does not exist. Sorted in Dutch order; memberships of inactive working groups are left out.
 */
export async function getMe(db: Db, userId: string): Promise<MeDetails | null> {
  const user = await getUserProfile(db, userId);
  if (!user) return null;
  const memberships = await db
    .select({
      id: workingGroupMemberships.id,
      role: workingGroupMemberships.role,
      groupId: workingGroups.id,
      groupName: workingGroups.name,
      city: workingGroups.city,
      organizationId: organizations.id,
      organizationName: organizations.name,
    })
    .from(workingGroupMemberships)
    .innerJoin(workingGroups, eq(workingGroups.id, workingGroupMemberships.workingGroupId))
    .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
    .where(and(eq(workingGroupMemberships.userId, userId), eq(workingGroups.active, true)))
    .orderBy(asc(dutch(organizations.name)), asc(dutch(workingGroups.name)), asc(workingGroups.id));
  const admins = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizationAdmins)
    .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
    .where(eq(organizationAdmins.userId, userId))
    .orderBy(asc(dutch(organizations.name)), asc(organizations.id));
  const [flag] = await db
    .select({ isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, userId));
  return {
    user: { ...user, isPlatformAdmin: flag?.isPlatformAdmin ?? false },
    memberships: memberships.map((m) => ({
      id: m.id,
      role: m.role,
      workingGroup: {
        id: m.groupId,
        name: m.groupName,
        city: m.city,
        organization: { id: m.organizationId, name: m.organizationName },
      },
    })),
    organizationAdminOf: admins,
  };
}
