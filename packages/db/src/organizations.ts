import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Access } from "./access";
import type { Db } from "./client";
import { organizationAdmins, organizations, users } from "./schema";
import { userHasLoggedIn } from "./users";

// Local types of the shape of the organization contracts; the endpoints' contracts replace them.

export type OrganizationRecord = { id: string; name: string; contactEmail: string | null };

export type OrganizationAdminRecord = {
  userId: string;
  name: string;
  email: string;
  hasLoggedIn: boolean;
};

export type OrganizationDetailRecord = OrganizationRecord & { admins: OrganizationAdminRecord[] };

const columns = {
  id: organizations.id,
  name: organizations.name,
  contactEmail: organizations.contactEmail,
};

const byDutchName = [asc(sql`${organizations.name} collate "nl-NL-x-icu"`), asc(organizations.id)];

/**
 * The organizations someone administers: all for a platform admin, otherwise those in
 * `adminOfOrganizationIds` (none for anyone who administers nothing). Sorted by name in Dutch
 * order.
 */
export async function listAdministeredOrganizations(
  db: Db,
  access: Pick<Access, "isPlatformAdmin" | "adminOfOrganizationIds">,
): Promise<OrganizationRecord[]> {
  if (access.isPlatformAdmin) {
    return db
      .select(columns)
      .from(organizations)
      .orderBy(...byDutchName);
  }
  if (access.adminOfOrganizationIds.length === 0) return [];
  return db
    .select(columns)
    .from(organizations)
    .where(inArray(organizations.id, access.adminOfOrganizationIds))
    .orderBy(...byDutchName);
}

/**
 * One organization with its admins, sorted by name in Dutch order, deleted accounts left out.
 * Not scoped: the caller authorizes. `null` when there is none.
 */
export async function getOrganization(
  db: Db,
  organizationId: string,
): Promise<OrganizationDetailRecord | null> {
  const [organization] = await db
    .select(columns)
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (!organization) return null;
  const admins = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      hasLoggedIn: userHasLoggedIn,
    })
    .from(organizationAdmins)
    .innerJoin(users, eq(users.id, organizationAdmins.userId))
    .where(and(eq(organizationAdmins.organizationId, organizationId), isNull(users.deletedAt)))
    .orderBy(asc(sql`${users.name} collate "nl-NL-x-icu"`), asc(users.id));
  return { ...organization, admins };
}
