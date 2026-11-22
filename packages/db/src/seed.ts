import { eq } from "drizzle-orm";
import {
  createOrganization,
  createWorkingGroup,
  findOrCreateAccount,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
} from "./admin";
import type { AuditActor } from "./audit-log";
import type { Db } from "./client";
import { users, workingGroupMemberships } from "./schema";
import { updateUserProfile } from "./users";

const system: AuditActor = { kind: "system" };

export function assertLocalSeed(publicOrigin: string | undefined): void {
  if (publicOrigin?.startsWith("https://")) {
    throw new Error("The seed is for local development only.");
  }
}

async function ensureOrganization(db: Db, name: string): Promise<string> {
  const existing = (await listOrganizations(db)).find((org) => org.name === name);
  return existing?.id ?? (await createOrganization(db, { name }, system)).id;
}

async function ensureWorkingGroup(
  db: Db,
  organizationId: string,
  name: string,
  city: string,
): Promise<string> {
  const organization = (await listOrganizations(db)).find((org) => org.id === organizationId);
  const existing = organization?.workingGroups.find((group) => group.name === name);
  return existing?.id ?? (await createWorkingGroup(db, { organizationId, name, city }, system)).id;
}

/** Sets the name only when it differs, so a second run changes nothing. */
async function setName(db: Db, userId: string, name: string): Promise<void> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  if (row?.name !== name) await updateUserProfile(db, userId, { name });
}

async function ensureAccount(db: Db, email: string, name: string): Promise<string> {
  const { id } = await findOrCreateAccount(db, email);
  await setName(db, id, name);
  return id;
}

async function ensureVolunteer(
  db: Db,
  email: string,
  name: string,
  workingGroupId: string,
): Promise<void> {
  const userId = await ensureAccount(db, email, name);
  await db
    .insert(workingGroupMemberships)
    .values({ userId, workingGroupId, role: "volunteer" })
    .onConflictDoNothing();
}

/** Made-up organizations, groups and people for local development. Idempotent. */
export async function seed(db: Db): Promise<void> {
  const voorbeeldstad = await ensureOrganization(db, "Paddentrek Voorbeeldstad");
  const fictiefdorp = await ensureOrganization(db, "Paddenwerkgroep Fictiefdorp");
  const noord = await ensureWorkingGroup(db, voorbeeldstad, "Noord", "Voorbeeldstad");
  const zuid = await ensureWorkingGroup(db, voorbeeldstad, "Zuid", "Voorbeeldstad");
  const dorp = await ensureWorkingGroup(db, fictiefdorp, "Dorp", "Fictiefdorp");

  const admin = await grantPlatformAdmin(db, { email: "hoofdbeheerder@example.test" }, system);
  await setName(db, admin.userId, "Hanna Hoofd");
  const orgAdmin = await grantOrganizationAdmin(
    db,
    { email: "beheerder@example.test", organizationId: voorbeeldstad },
    system,
  );
  await setName(db, orgAdmin.userId, "Bram Beheer");
  const coordinator = await grantCoordinator(
    db,
    { email: "coordinator@example.test", workingGroupId: noord },
    system,
  );
  await setName(db, coordinator.userId, "Carla Coördinator");

  await ensureVolunteer(db, "vrijwilliger@example.test", "Vera Vrijwilliger", noord);
  await ensureVolunteer(db, "dubbel@example.test", "Daan Dubbel", zuid);
  await ensureVolunteer(db, "dubbel@example.test", "Daan Dubbel", dorp);
  await ensureAccount(db, "aanmelder@example.test", "Noor Nieuw");
}
