import {
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  workingGroupMemberships,
} from "@padvinder/db";
import type { WorkingGroupTarget } from "../permissions/rules";
import { loginAs, type TestApp } from "./login";

export type CastMember =
  | "platformAdmin"
  | "organizationAdmin"
  | "coordinator"
  | "volunteer"
  | "volunteerOtherGroup"
  | "coordinatorOtherOrganization"
  | "applicant";

export type CastLogin = { userId: string; email: string; headers: { cookie: string } };

export type Cast = {
  organization: { id: string };
  otherOrganization: { id: string };
  /** In `organization`; `coordinator` and `volunteer` belong to it. */
  workingGroup: WorkingGroupTarget;
  /** In `organization`; `volunteerOtherGroup` belongs to it. */
  otherGroup: WorkingGroupTarget;
  /** In `otherOrganization`; `coordinatorOtherOrganization` belongs to it. */
  foreignGroup: WorkingGroupTarget;
  members: Record<CastMember, CastLogin>;
};

const system = { kind: "system" } as const;

/**
 * The standard cast for permission tests: two organizations, three working groups and seven
 * logged-in people, made through the real login flow and the administration functions.
 */
export async function createCast(ctx: TestApp): Promise<Cast> {
  const db = ctx.t.db;
  const organization = await createOrganization(db, { name: "Cast Organisatie" }, system);
  const otherOrganization = await createOrganization(db, { name: "Cast Andere" }, system);
  const group = async (organizationId: string, name: string): Promise<WorkingGroupTarget> => {
    const created = await createWorkingGroup(
      db,
      { organizationId, name, city: "Enschede" },
      system,
    );
    return { workingGroupId: created.id, organizationId };
  };
  const workingGroup = await group(organization.id, "Cast Werkgroep");
  const otherGroup = await group(organization.id, "Cast Andere werkgroep");
  const foreignGroup = await group(otherOrganization.id, "Cast Vreemde werkgroep");

  const login = async (member: CastMember): Promise<CastLogin> => {
    const email = `cast-${member}@example.test`;
    const session = await loginAs(ctx, email, { name: `Cast ${member}` });
    return { ...session, email };
  };
  const members = {
    platformAdmin: await login("platformAdmin"),
    organizationAdmin: await login("organizationAdmin"),
    coordinator: await login("coordinator"),
    volunteer: await login("volunteer"),
    volunteerOtherGroup: await login("volunteerOtherGroup"),
    coordinatorOtherOrganization: await login("coordinatorOtherOrganization"),
    applicant: await login("applicant"),
  } satisfies Record<CastMember, CastLogin>;

  await grantPlatformAdmin(db, { email: members.platformAdmin.email }, system);
  await grantOrganizationAdmin(
    db,
    { email: members.organizationAdmin.email, organizationId: organization.id },
    system,
  );
  await grantCoordinator(
    db,
    { email: members.coordinator.email, workingGroupId: workingGroup.workingGroupId },
    system,
  );
  await grantCoordinator(
    db,
    {
      email: members.coordinatorOtherOrganization.email,
      workingGroupId: foreignGroup.workingGroupId,
    },
    system,
  );
  // There is no administration function for a volunteer: approval comes later.
  await db.insert(workingGroupMemberships).values([
    {
      userId: members.volunteer.userId,
      workingGroupId: workingGroup.workingGroupId,
      isCoordinator: false,
    },
    {
      userId: members.volunteerOtherGroup.userId,
      workingGroupId: otherGroup.workingGroupId,
      isCoordinator: false,
    },
  ]);

  return { organization, otherOrganization, workingGroup, otherGroup, foreignGroup, members };
}

/**
 * Sends the request once per cast member and once without a cookie, and checks every status.
 * `expected` names every member, so a new endpoint cannot skip one. All mismatches are reported
 * in one failure, each with the member's name.
 */
export async function expectStatuses(
  cast: Cast,
  expected: Record<CastMember | "anonymous", number>,
  send: (headers: Record<string, string>) => Promise<{ statusCode: number }>,
): Promise<void> {
  const who = [...(Object.keys(cast.members) as CastMember[]), "anonymous" as const];
  const mismatches: string[] = [];
  for (const name of who) {
    const headers = name === "anonymous" ? {} : cast.members[name].headers;
    const { statusCode } = await send(headers);
    if (statusCode !== expected[name]) {
      mismatches.push(`${name}: expected ${expected[name]}, got ${statusCode}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Unexpected statuses:\n${mismatches.join("\n")}`);
  }
}
