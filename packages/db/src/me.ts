import { and, asc, eq, sql, type AnyColumn } from "drizzle-orm";
import type { Db } from "./client";
import {
  organizationAdmins,
  organizations,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

/**
 * The working groups and organizations of a user, with their names, for `/api/me`. The profile
 * and the platform flag are not here: the API has them already, read with the session.
 */
export type MeRoles = {
  memberships: {
    id: string;
    isCoordinator: boolean;
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
 * The memberships and administrator rights of a user, sorted in Dutch order. Memberships of
 * inactive working groups are left out. Empty lists for a user that does not exist.
 */
export async function getMeRoles(db: Db, userId: string): Promise<MeRoles> {
  const [memberships, admins] = await Promise.all([
    db
      .select({
        id: workingGroupMemberships.id,
        isCoordinator: workingGroupMemberships.isCoordinator,
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
      .orderBy(
        asc(dutch(organizations.name)),
        asc(dutch(workingGroups.name)),
        asc(workingGroups.id),
      ),
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizationAdmins)
      .innerJoin(organizations, eq(organizations.id, organizationAdmins.organizationId))
      .where(eq(organizationAdmins.userId, userId))
      .orderBy(asc(dutch(organizations.name)), asc(organizations.id)),
  ]);
  return {
    memberships: memberships.map((m) => ({
      id: m.id,
      isCoordinator: m.isCoordinator,
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
