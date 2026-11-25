import { and, eq, isNull } from "drizzle-orm";
import {
  createOrganization,
  createWorkingGroup,
  findOrCreateAccount,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
  updateOrganization,
} from "./admin";
import type { AuditActor } from "./audit-log";
import type { Db } from "./client";
import { createMembershipRequest } from "./membership-requests";
import { organizations, users, workingGroupMemberships } from "./schema";
import { updateUserProfile } from "./users";

const system: AuditActor = { kind: "system" };

/**
 * The ID of the applicant's pending request: a fixed, made-up UUIDv7, so a second run finds the
 * request instead of making another one.
 */
export const SEED_MEMBERSHIP_REQUEST_ID = "01a2027b-d680-7000-8000-000000000001";

export function assertLocalSeed(publicOrigin: string | undefined): void {
  if (publicOrigin?.startsWith("https://")) {
    throw new Error("The seed is for local development only.");
  }
}

/**
 * The organization with its admin and contact address. One that exists already (seeded before
 * every organization had an admin) gets them too; a second run changes nothing.
 */
async function ensureOrganization(
  db: Db,
  input: { name: string; adminEmail: string; adminName: string; contactEmail: string | null },
): Promise<string> {
  const existing = (await listOrganizations(db)).find((org) => org.name === input.name);
  const organizationId =
    existing?.id ??
    (
      await createOrganization(
        db,
        { name: input.name, adminEmail: input.adminEmail, contactEmail: input.contactEmail },
        system,
      )
    ).id;
  const admin = await grantOrganizationAdmin(
    db,
    { email: input.adminEmail, organizationId },
    system,
  );
  await setName(db, admin.userId, input.adminName);
  // Fills in a missing contact address; one a developer changed locally stays.
  const [stored] = await db
    .select({ contactEmail: organizations.contactEmail })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  if (input.contactEmail !== null && stored?.contactEmail === null) {
    await updateOrganization(
      db,
      { organizationId, patch: { contactEmail: input.contactEmail } },
      system,
    );
  }
  return organizationId;
}

/**
 * The working group with its coordinator. One that exists already (seeded before every working
 * group had a coordinator) gets the coordinator too; a second run changes nothing. A group a
 * developer switched off locally is left as it is: it may be without a coordinator. Without a
 * `coordinatorName` the coordinator stays as the tool makes them: no name, never logged in.
 */
async function ensureWorkingGroup(
  db: Db,
  organizationId: string,
  input: { name: string; city: string; coordinatorEmail: string; coordinatorName: string | null },
): Promise<string> {
  const organization = (await listOrganizations(db)).find((org) => org.id === organizationId);
  const existing = organization?.workingGroups.find((group) => group.name === input.name);
  let id: string;
  let coordinatorId: string | undefined;
  if (!existing) {
    const created = await createWorkingGroup(
      db,
      {
        organizationId,
        name: input.name,
        city: input.city,
        coordinatorEmail: input.coordinatorEmail,
      },
      system,
    );
    id = created.id;
    coordinatorId = created.coordinatorUserId;
  } else {
    id = existing.id;
    if (existing.active) {
      const granted = await grantCoordinator(
        db,
        { email: input.coordinatorEmail, workingGroupId: id },
        system,
      );
      coordinatorId = granted.userId;
    }
  }
  if (coordinatorId !== undefined && input.coordinatorName !== null) {
    await setName(db, coordinatorId, input.coordinatorName);
  }
  return id;
}

/**
 * Sets the name only when it differs, so a second run changes nothing. A person with a name has
 * logged in, so local lists look like real use: `last_login_at` is set when it is empty.
 */
async function setName(db: Db, userId: string, name: string): Promise<void> {
  const [row] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
  if (row?.name !== name) await updateUserProfile(db, userId, { name });
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.lastLoginAt)));
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
  await db.insert(workingGroupMemberships).values({ userId, workingGroupId }).onConflictDoNothing();
}

/** Made-up organizations, groups and people for local development. Idempotent. */
export async function seed(db: Db): Promise<void> {
  const voorbeeldstad = await ensureOrganization(db, {
    name: "Paddentrek Voorbeeldstad",
    adminEmail: "beheerder@example.test",
    adminName: "Bram Beheer",
    contactEmail: "contact-voorbeeldstad@example.test",
  });
  const fictiefdorp = await ensureOrganization(db, {
    name: "Paddenwerkgroep Fictiefdorp",
    adminEmail: "beheerder-fictiefdorp@example.test",
    adminName: "Fenna Fictief",
    contactEmail: null,
  });
  const noord = await ensureWorkingGroup(db, voorbeeldstad, {
    name: "Noord",
    city: "Voorbeeldstad",
    coordinatorEmail: "coordinator@example.test",
    coordinatorName: "Carla Coördinator",
  });
  const zuid = await ensureWorkingGroup(db, voorbeeldstad, {
    name: "Zuid",
    city: "Voorbeeldstad",
    coordinatorEmail: "coordinator-zuid@example.test",
    coordinatorName: "Zoë Zuid",
  });
  // The example of a coordinator who never logged in: no name, no last_login_at.
  const dorp = await ensureWorkingGroup(db, fictiefdorp, {
    name: "Dorp",
    city: "Fictiefdorp",
    coordinatorEmail: "coordinator-dorp@example.test",
    coordinatorName: null,
  });

  const admin = await grantPlatformAdmin(db, { email: "hoofdbeheerder@example.test" }, system);
  await setName(db, admin.userId, "Hanna Hoofd");

  await ensureVolunteer(db, "vrijwilliger@example.test", "Vera Vrijwilliger", noord);
  await ensureVolunteer(db, "dubbel@example.test", "Daan Dubbel", zuid);
  await ensureVolunteer(db, "dubbel@example.test", "Daan Dubbel", dorp);
  const applicant = await ensureAccount(db, "aanmelder@example.test", "Noor Nieuw");
  // A second run answers `existing` and changes nothing. A developer who decided, withdrew or
  // deleted it locally keeps it that way; the seed does not undo it.
  const now = new Date();
  await createMembershipRequest(db, {
    id: SEED_MEMBERSHIP_REQUEST_ID,
    userId: applicant,
    workingGroupId: zuid,
    requestedAt: now,
    now,
  });
}
