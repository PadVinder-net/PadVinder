import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deleteAccount } from "./accounts";
import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
} from "./admin";
import { getAccess } from "./access";
import type { AuditActor } from "./audit-log";
import { getOrganization, listAdministeredOrganizations } from "./organizations";
import { passkeys, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

const system: AuditActor = { kind: "system" };
let t: TestDatabase | undefined;
const db = () => t!.db;

let zeta: string;
let eend: string;
let alfa: string;
beforeAll(async () => {
  t = await createTestDatabase();
  zeta = (
    await createOrganization(
      db(),
      { name: "Zeta", adminEmail: "zeta@example.test", contactEmail: "info-zeta@example.test" },
      system,
    )
  ).id;
  eend = (await createOrganization(db(), { name: "Éend", adminEmail: "eend@example.test" }, system))
    .id;
  alfa = (await createOrganization(db(), { name: "Alfa", adminEmail: "alfa@example.test" }, system))
    .id;
});
afterAll(async () => {
  await t?.drop();
});

async function accessOf(email: string) {
  const [row] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  return (await getAccess(db(), row!.id))!;
}

test("a platform admin lists all organizations, an admin their own, a coordinator none", async () => {
  await grantPlatformAdmin(db(), { email: "hoofd@example.test" }, system);
  const group = await createWorkingGroup(
    db(),
    {
      organizationId: zeta,
      name: "Noord",
      city: "Zetastad",
      coordinatorEmail: "coord@example.test",
    },
    system,
  );
  await grantCoordinator(db(), { email: "coord@example.test", workingGroupId: group.id }, system);
  await grantOrganizationAdmin(db(), { email: "eend@example.test", organizationId: zeta }, system);

  expect(await listAdministeredOrganizations(db(), await accessOf("hoofd@example.test"))).toEqual([
    { id: alfa, name: "Alfa", contactEmail: null },
    { id: eend, name: "Éend", contactEmail: null },
    { id: zeta, name: "Zeta", contactEmail: "info-zeta@example.test" },
  ]);
  expect(await listAdministeredOrganizations(db(), await accessOf("eend@example.test"))).toEqual([
    { id: eend, name: "Éend", contactEmail: null },
    { id: zeta, name: "Zeta", contactEmail: "info-zeta@example.test" },
  ]);
  expect(await listAdministeredOrganizations(db(), await accessOf("alfa@example.test"))).toEqual([
    { id: alfa, name: "Alfa", contactEmail: null },
  ]);
  expect(await listAdministeredOrganizations(db(), await accessOf("coord@example.test"))).toEqual(
    [],
  );
});

test("getOrganization lists the admins by name, without deleted accounts", async () => {
  const organization = await createOrganization(
    db(),
    { name: "Beheerders", adminEmail: "zoe@example.test" },
    system,
  );
  const organizationId = organization.id;
  const anna = await grantOrganizationAdmin(
    db(),
    { email: "anna@example.test", organizationId },
    system,
  );
  const weg = await grantOrganizationAdmin(
    db(),
    { email: "weg@example.test", organizationId },
    system,
  );
  await db()
    .update(users)
    .set({ name: "Zoë Zuid", lastLoginAt: new Date() })
    .where(eq(users.id, organization.adminUserId));
  await db().update(users).set({ name: "Éva Eerst" }).where(eq(users.id, anna.userId));
  await db().update(users).set({ name: "Willem Weg" }).where(eq(users.id, weg.userId));
  expect(await deleteAccount(db(), { userId: weg.userId, now: new Date() })).toEqual({
    outcome: "deleted",
  });

  expect(await getOrganization(db(), organizationId)).toEqual({
    id: organizationId,
    name: "Beheerders",
    contactEmail: null,
    admins: [
      {
        userId: anna.userId,
        name: "Éva Eerst",
        email: "anna@example.test",
        hasLoggedIn: false,
        hasPasskey: false,
        mayResetPasskeys: false,
        isPlatformAdmin: false,
      },
      {
        userId: organization.adminUserId,
        name: "Zoë Zuid",
        email: "zoe@example.test",
        hasLoggedIn: true,
        hasPasskey: false,
        mayResetPasskeys: false,
        isPlatformAdmin: false,
      },
    ],
  });
});

test("getOrganization is null for an organization that does not exist", async () => {
  expect(await getOrganization(db(), "01900000-0000-7000-8000-000000000000")).toBeNull();
});

test("getOrganization says who has a passkey", async () => {
  const { id: organizationId, adminUserId } = await createOrganization(
    db(),
    { name: "Sleutels", adminEmail: "sleutel-admin@example.test" },
    system,
  );
  await db().insert(passkeys).values({
    userId: adminUserId,
    publicKey: "pk",
    credentialID: "cred-org-admin",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
  });
  const detail = await getOrganization(db(), organizationId);
  expect(detail?.admins).toMatchObject([{ userId: adminUserId, hasPasskey: true }]);
});
