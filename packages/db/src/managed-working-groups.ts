import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Access } from "./access";
import type { Db } from "./client";
import {
  membershipRequests,
  organizations,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";

/** A working group as the portal's administration shows it. */
// The contract of the working group endpoints (a later task) will infer this type from its schema.
export type ManagedWorkingGroup = {
  id: string;
  name: string;
  city: string;
  active: boolean;
  organization: { id: string; name: string };
  /** Members, coordinators included, without deleted accounts. */
  memberCount: number;
  /** Requests that wait for a decision. */
  pendingRequestCount: number;
};

function selectManagedWorkingGroups(db: Db) {
  return db
    .select({
      id: workingGroups.id,
      name: workingGroups.name,
      city: workingGroups.city,
      active: workingGroups.active,
      organization: { id: organizations.id, name: organizations.name },
      memberCount: sql<number>`(select count(*)::int from ${workingGroupMemberships} inner join ${users} on ${users.id} = ${workingGroupMemberships.userId} where ${workingGroupMemberships.workingGroupId} = ${workingGroups.id} and ${users.deletedAt} is null)`,
      pendingRequestCount: sql<number>`(select count(*)::int from ${membershipRequests} where ${membershipRequests.workingGroupId} = ${workingGroups.id} and ${membershipRequests.status} = 'pending')`,
    })
    .from(workingGroups)
    .innerJoin(organizations, eq(organizations.id, workingGroups.organizationId))
    .$dynamic();
}

/**
 * The working groups the user administers: for a platform admin every group; otherwise every
 * group, active or not, of the organizations they are an admin of, and the active groups they
 * coordinate (`getAccess` already leaves out inactive groups). Each group once, sorted by
 * organization name and then by name, in Dutch order.
 */
export async function listManagedWorkingGroups(
  db: Db,
  access: Access,
): Promise<ManagedWorkingGroup[]> {
  let where: SQL | undefined;
  if (!access.isPlatformAdmin) {
    const coordinated = access.memberships
      .filter((membership) => membership.isCoordinator)
      .map((membership) => membership.workingGroupId);
    const scopes: SQL[] = [];
    if (access.adminOfOrganizationIds.length > 0) {
      scopes.push(inArray(workingGroups.organizationId, access.adminOfOrganizationIds));
    }
    if (coordinated.length > 0) {
      scopes.push(and(inArray(workingGroups.id, coordinated), eq(workingGroups.active, true))!);
    }
    if (scopes.length === 0) return [];
    where = or(...scopes);
  }
  return selectManagedWorkingGroups(db)
    .where(where)
    .orderBy(
      sql`${organizations.name} COLLATE "nl-NL-x-icu"`,
      asc(organizations.id),
      sql`${workingGroups.name} COLLATE "nl-NL-x-icu"`,
      asc(workingGroups.id),
    );
}

/** One working group, or `null`. Not scoped: the route decides whether the actor may see it. */
export async function getManagedWorkingGroup(
  db: Db,
  workingGroupId: string,
): Promise<ManagedWorkingGroup | null> {
  const [row] = await selectManagedWorkingGroups(db).where(eq(workingGroups.id, workingGroupId));
  return row ?? null;
}
