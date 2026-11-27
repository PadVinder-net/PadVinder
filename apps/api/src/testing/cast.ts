import {
  createOrganization,
  createWorkingGroup,
  grantPlatformAdmin,
  workingGroupMemberships,
} from "@padvinder/db";
import type { WorkingGroupTarget } from "../permissions/rules";
import { loginAs, type TestApp } from "./login";
import { stampSession } from "./passkeys";

export type CastMember =
  | "platformAdmin"
  | "organizationAdmin"
  | "coordinator"
  | "volunteer"
  | "volunteerOtherGroup"
  | "coordinatorOtherOrganization"
  | "organizationAdminOtherOrganization"
  | "applicant";

export type CastLogin = { userId: string; email: string; headers: { cookie: string } };

export type Cast = {
  /** `organizationAdmin` is its only admin. */
  organization: { id: string };
  /** `organizationAdminOtherOrganization` is its only admin. */
  otherOrganization: { id: string };
  /** In `organization`; `coordinator` and `volunteer` belong to it. */
  workingGroup: WorkingGroupTarget;
  /**
   * In `organization`; `volunteerOtherGroup` belongs to it. Its coordinator is
   * `OTHER_GROUP_COORDINATOR_EMAIL`, an account that never logs in and is no cast member.
   */
  otherGroup: WorkingGroupTarget;
  /** In `otherOrganization`; `coordinatorOtherOrganization` belongs to it. */
  foreignGroup: WorkingGroupTarget;
  members: Record<CastMember, CastLogin>;
};

const system = { kind: "system" } as const;

/** The first coordinator of `otherGroup`: every active working group has one. */
export const OTHER_GROUP_COORDINATOR_EMAIL = "cast-coordinator-other-group@example.test";

/**
 * The standard cast for permission tests: two organizations, three working groups and eight
 * logged-in people, made through the real login flow and the administration functions.
 */
export async function createCast(ctx: TestApp): Promise<Cast> {
  const db = ctx.t.db;
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
    organizationAdminOtherOrganization: await login("organizationAdminOtherOrganization"),
    applicant: await login("applicant"),
  } satisfies Record<CastMember, CastLogin>;

  // The admins are recently confirmed, so the existing admin tests meet no confirmation rule.
  for (const admin of [
    members.platformAdmin,
    members.organizationAdmin,
    members.organizationAdminOtherOrganization,
  ]) {
    await stampSession(ctx, admin.headers.cookie, new Date());
  }

  const newOrganization = async (name: string, admin: CastLogin) => {
    const created = await createOrganization(db, { name, adminEmail: admin.email }, system);
    return { id: created.id };
  };
  const organization = await newOrganization("Cast Organisatie", members.organizationAdmin);
  const otherOrganization = await newOrganization(
    "Cast Andere",
    members.organizationAdminOtherOrganization,
  );
  const group = async (
    organizationId: string,
    name: string,
    coordinatorEmail: string,
  ): Promise<WorkingGroupTarget> => {
    const created = await createWorkingGroup(
      db,
      { organizationId, name, city: "Enschede", coordinatorEmail },
      system,
    );
    return { workingGroupId: created.id, organizationId };
  };
  const workingGroup = await group(organization.id, "Cast Werkgroep", members.coordinator.email);
  // Its coordinator is no cast member and never logs in.
  const otherGroup = await group(
    organization.id,
    "Cast Andere werkgroep",
    OTHER_GROUP_COORDINATOR_EMAIL,
  );
  const foreignGroup = await group(
    otherOrganization.id,
    "Cast Vreemde werkgroep",
    members.coordinatorOtherOrganization.email,
  );

  await grantPlatformAdmin(db, { email: members.platformAdmin.email }, system);
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
