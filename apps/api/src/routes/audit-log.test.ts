import {
  auditLogEntries,
  officialSpeciesIds,
  recordAudit,
  workingGroupMemberships,
} from "@padvinder/db";
import { AUDIT_LOG_PAGE_SIZE } from "@padvinder/contracts";
import type { AuditLogEntry, AuditLogPage } from "@padvinder/contracts";
import { count, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createCast, expectStatuses, type Cast } from "../testing/cast";
import { createTestApp, loginAs, type TestApp } from "../testing/login";

let ctx: TestApp;
let cast: Cast;
const REMOVED_NAME = "Aanvrager Zeta";
const DELETED_NAME = "Weg Persoon";

type Headers = Record<string, string>;
const read = (headers: Headers, query = "") =>
  ctx.app.inject({ url: `/api/audit-log-entries${query}`, headers });
const page = async (headers: Headers, query = ""): Promise<AuditLogPage> => {
  const res = await read(headers, query);
  expect(res.statusCode).toBe(200);
  return res.json() as AuditLogPage;
};

beforeAll(async () => {
  ctx = await createTestApp();
  cast = await createCast(ctx);

  // A request that is approved, and the member removed again.
  const requester = await loginAs(ctx, "aanvrager-zeta@example.test", { name: REMOVED_NAME });
  const requested = await ctx.app.inject({
    method: "POST",
    url: "/api/membership-requests",
    headers: requester.headers,
    payload: {
      id: uuidv7(),
      workingGroupId: cast.workingGroup.workingGroupId,
      requestedAt: new Date().toISOString(),
    },
  });
  expect(requested.statusCode).toBe(201);
  const approved = await ctx.app.inject({
    method: "POST",
    url: `/api/membership-requests/${requested.json().id}/approve`,
    headers: cast.members.coordinator.headers,
  });
  expect(approved.statusCode).toBe(200);
  const [membership] = await ctx.t.db
    .select({ id: workingGroupMemberships.id })
    .from(workingGroupMemberships)
    .where(eq(workingGroupMemberships.userId, requester.userId));
  const removed = await ctx.app.inject({
    method: "DELETE",
    url: `/api/memberships/${membership!.id}`,
    headers: cast.members.coordinator.headers,
  });
  expect(removed.statusCode).toBe(204);

  // A deleted account, and a species.
  const leaver = await loginAs(ctx, "weg-persoon@example.test", { name: DELETED_NAME });
  const deleted = await ctx.app.inject({
    method: "DELETE",
    url: "/api/me",
    headers: leaver.headers,
  });
  expect(deleted.statusCode).toBe(204);
  const species = await ctx.app.inject({
    method: "POST",
    url: "/api/species",
    headers: cast.members.platformAdmin.headers,
    payload: {
      dutchName: "auditsoort",
      scientificName: "Auditus soortus",
      needsVerification: false,
    },
  });
  expect(species.statusCode).toBe(201);
});
afterAll(() => ctx.close());

const everyone = {
  platformAdmin: 200,
  organizationAdmin: 200,
  coordinator: 200,
  volunteer: 200,
  volunteerOtherGroup: 200,
  coordinatorOtherOrganization: 200,
  organizationAdminOtherOrganization: 200,
  applicant: 200,
  anonymous: 401,
};
const adminsOfIt = {
  platformAdmin: 200,
  organizationAdmin: 200,
  coordinator: 404,
  volunteer: 404,
  volunteerOtherGroup: 404,
  coordinatorOtherOrganization: 404,
  organizationAdminOtherOrganization: 404,
  applicant: 404,
  anonymous: 401,
};

test("everyone logged in gets their own page", async () =>
  await expectStatuses(cast, everyone, (headers) => read(headers)));

test("only its admins and platform admins read the log of an organization", async () =>
  await expectStatuses(cast, adminsOfIt, (headers) =>
    read(headers, `?organizationId=${cast.organization.id}`),
  ));

test("the organization admin's page holds entries of their organization only, and none without one", async () => {
  const { entries } = await page(cast.members.organizationAdmin.headers);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) expect(entry.organization?.id).toBe(cast.organization.id);
  const actions = entries.map((entry) => entry.action);
  expect(actions).not.toContain("species.created");
  expect(actions).not.toContain("role.platform_admin_granted");
  expect(actions).toContain("membership_request.approved");
  expect(actions).toContain("membership.removed");
});

test("a coordinator's, a volunteer's and the applicant's page is empty", async () => {
  for (const who of ["coordinator", "volunteer", "applicant"] as const) {
    expect(await page(cast.members[who].headers)).toEqual({ entries: [], nextCursor: null });
  }
});

test("the platform admin's page holds entries of both organizations and those without one", async () => {
  const { entries } = await page(cast.members.platformAdmin.headers);
  const organizationIds = new Set(entries.map((entry) => entry.organization?.id ?? null));
  expect(organizationIds).toContain(cast.organization.id);
  expect(organizationIds).toContain(cast.otherOrganization.id);
  expect(organizationIds).toContain(null);
  const actions = entries.map((entry) => entry.action);
  expect(actions).toContain("species.created");
  expect(actions).toContain("account.deleted");
});

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

test("the organization admin's raw answer holds no name they may not see", async () => {
  const res = await read(cast.members.organizationAdmin.headers);
  const body = res.body;
  expect(body).not.toContain(REMOVED_NAME);
  expect(body).not.toContain(DELETED_NAME);
  expect(body).not.toContain(cast.members.platformAdmin.email);
  expect(body).not.toContain("Cast platformAdmin");
  expect(body).not.toContain("Cast organizationAdminOtherOrganization");
  expect(body).not.toContain("Cast coordinatorOtherOrganization");
  expect(body).not.toContain("@");
  for (const member of Object.values(cast.members)) expect(body).not.toContain(member.userId);
  const keys = keysOf(res.json());
  for (const key of ["email", "phone", "userId", "actorUserId"]) expect(keys).not.toContain(key);
});

test("the platform admin's raw answer holds no email address and no phone number", async () => {
  const res = await read(cast.members.platformAdmin.headers);
  expect(res.body).not.toContain("@");
  const keys = keysOf(res.json());
  for (const key of ["email", "phone", "userId", "actorUserId"]) expect(keys).not.toContain(key);
});

test("a cursor from the platform admin's page gives the organization admin only their own entries", async () => {
  // Newer entries without an organization, so the platform admin's first page is full and its
  // cursor points at an entry older than all of them.
  await ctx.t.db.transaction(async (tx) => {
    for (let i = 0; i < AUDIT_LOG_PAGE_SIZE; i++) {
      await recordAudit(tx, {
        actor: { kind: "system" },
        organizationId: null,
        action: "species.updated",
        subject: { type: "species", id: Object.values(officialSpeciesIds)[0]! },
        details: { active: true },
      });
    }
  });
  const first = await page(cast.members.platformAdmin.headers);
  expect(first.entries).toHaveLength(AUDIT_LOG_PAGE_SIZE);
  expect(first.nextCursor).not.toBeNull();
  // The cursor is only a position; borrowed from the platform admin it widens nothing.
  const { entries } = await page(
    cast.members.organizationAdmin.headers,
    `?cursor=${encodeURIComponent(first.nextCursor!)}`,
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) expect(entry.organization?.id).toBe(cast.organization.id);
});

test("actionGroup narrows the page; with organizationId both apply", async () => {
  const species = await page(cast.members.platformAdmin.headers, "?actionGroup=species");
  expect(species.entries.length).toBeGreaterThan(0);
  for (const entry of species.entries) expect(entry.action.startsWith("species.")).toBe(true);

  const query = `?actionGroup=membership&organizationId=${cast.organization.id}`;
  const { entries } = await page(cast.members.platformAdmin.headers, query);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries as AuditLogEntry[]) {
    expect(entry.action.startsWith("membership")).toBe(true);
    expect(entry.organization?.id).toBe(cast.organization.id);
  }
});

test("an organizationId no organization has is 404 for an organization admin and an empty page for a platform admin", async () => {
  const query = `?organizationId=${uuidv7()}`;
  expect((await read(cast.members.organizationAdmin.headers, query)).statusCode).toBe(404);
  expect(await page(cast.members.platformAdmin.headers, query)).toEqual({
    entries: [],
    nextCursor: null,
  });
});

test.each([
  "?actionGroup=people",
  "?cursor=x",
  "?organisationId=0192f3c0-0000-7000-8000-000000000001",
  "?organizationId=x",
])("%s is 400", async (query) => {
  const res = await read(cast.members.platformAdmin.headers, query);
  expect(res.statusCode).toBe(400);
  expect(res.json().code).toBe("invalid_request");
});

test("reading writes no entry, and POST, PATCH and DELETE on the path are 404", async () => {
  const [before] = await ctx.t.db.select({ n: count() }).from(auditLogEntries);
  await read(cast.members.platformAdmin.headers);
  for (const method of ["POST", "PATCH", "DELETE"] as const) {
    const res = await ctx.app.inject({
      method,
      url: "/api/audit-log-entries",
      headers: cast.members.platformAdmin.headers,
      payload: method === "DELETE" ? undefined : {},
    });
    expect(res.statusCode).toBe(404);
  }
  const [after] = await ctx.t.db.select({ n: count() }).from(auditLogEntries);
  expect(after!.n).toBe(before!.n);
});
