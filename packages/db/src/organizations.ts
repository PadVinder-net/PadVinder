import type { Organization, OrganizationAdmin, OrganizationDetail } from "@padvinder/contracts";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Access } from "./access";
import type { Db } from "./client";
import { organizationAdmins, organizations, users } from "./schema";
import { userHasPasskey } from "./passkeys";
import { userHasLoggedIn } from "./users";

export type OrganizationRecord = Organization;
export type OrganizationAdminRecord = OrganizationAdmin;
/** The admins also say whether they are platform admins, for the route's decision; it never goes out. */
export type OrganizationDetailRecord = Omit<OrganizationDetail, "admins"> & {
  admins: (OrganizationAdmin & { isPlatformAdmin: boolean })[];
};

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
      hasPasskey: userHasPasskey,
      isPlatformAdmin: users.isPlatformAdmin,
    })
    .from(organizationAdmins)
    .innerJoin(users, eq(users.id, organizationAdmins.userId))
    .where(and(eq(organizationAdmins.organizationId, organizationId), isNull(users.deletedAt)))
    .orderBy(asc(sql`${users.name} collate "nl-NL-x-icu"`), asc(users.id));
  // The route decides `mayResetPasskeys`; the database layer never says yes.
  return {
    ...organization,
    admins: admins.map((admin) => ({ ...admin, mayResetPasskeys: false })),
  };
}
