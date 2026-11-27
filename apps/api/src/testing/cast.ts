import {
  createOrganization,
  createWorkingGroup,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  workingGroupMemberships,
} from "@padvinder/db";
import type { WorkingGroupTarget } from "../permissions/rules";
import { loginAs, type TestApp } from "./login";
import { stampSession } from "./passkeys";

export type CastMember =
  | "platformAdmin"
  | "platformAdminUnconfirmed"
  | "organizationAdmin"
  | "organizationAdminUnconfirmed"
  | "coordinator"
  | "volunteer"
  | "volunteerOtherGroup"
  | "coordinatorOtherOrganization"
  | "organizationAdminOtherOrganization"
  | "applicant";

export type ExpectedStatuses = Record<CastMember | "anonymous", number | "passkey_required">;

export type CastLogin = { userId: string; email: string; headers: { cookie: string } };

export type Cast = {
  /** Its admins are `organizationAdmin` and `organizationAdminUnconfirmed`. */
  organization: { id: string };
  /** `organizationAdminOtherOrganization` is its only admin. */
  otherOrganization: { id: string };
  /**
   * In `organization`; `coordinator`, `volunteer` and `organizationAdminUnconfirmed` belong to it.
   */
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
 * The standard cast for permission tests: two organizations, three working groups and ten
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
    platformAdminUnconfirmed: await login("platformAdminUnconfirmed"),
    organizationAdmin: await login("organizationAdmin"),
    organizationAdminUnconfirmed: await login("organizationAdminUnconfirmed"),
    coordinator: await login("coordinator"),
    volunteer: await login("volunteer"),
    volunteerOtherGroup: await login("volunteerOtherGroup"),
    coordinatorOtherOrganization: await login("coordinatorOtherOrganization"),
    organizationAdminOtherOrganization: await login("organizationAdminOtherOrganization"),
    applicant: await login("applicant"),
  } satisfies Record<CastMember, CastLogin>;

  // Three admins are recently confirmed, so the existing admin tests meet no confirmation rule.
  // The two unconfirmed admins are never stamped: their sessions have no passkey moment.
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
  await grantPlatformAdmin(db, { email: members.platformAdminUnconfirmed.email }, system);
  await grantOrganizationAdmin(
    db,
    { email: members.organizationAdminUnconfirmed.email, organizationId: organization.id },
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
      userId: members.organizationAdminUnconfirmed.userId,
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
  expected: ExpectedStatuses,
  send: (headers: Record<string, string>) => Promise<{ statusCode: number; body: string }>,
): Promise<void> {
  const who = [...(Object.keys(cast.members) as CastMember[]), "anonymous" as const];
  const mismatches: string[] = [];
  for (const name of who) {
    const headers = name === "anonymous" ? {} : cast.members[name].headers;
    const { statusCode, body } = await send(headers);
    const want = expected[name];
    const code = statusCode === 403 ? errorCodeOf(body) : undefined;
    const wantStatus = want === "passkey_required" ? 403 : want;
    const matches =
      statusCode === wantStatus && (want === "passkey_required") === (code === "passkey_required");
    if (!matches) {
      const got = code === "passkey_required" ? "passkey_required" : String(statusCode);
      mismatches.push(`${name}: expected ${want}, got ${got}`);
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`Unexpected statuses:\n${mismatches.join("\n")}`);
  }
}

function errorCodeOf(body: string): unknown {
  try {
    return (JSON.parse(body) as { code?: unknown }).code;
  } catch {
    return undefined;
  }
}
