import { randomUUID } from "node:crypto";
import type { AuditLogPage } from "@padvinder/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { getAccess } from "./access";
import { recordAudit, type AuditEntry } from "./audit-log";
import { listAuditLogEntries } from "./audit-log-entries";
import {
  membershipRequests,
  organizationAdmins,
  organizations,
  species,
  users,
  workingGroupMemberships,
  workingGroups,
} from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});
const db = () => t!.db;

const platform = { isPlatformAdmin: true, adminOfOrganizationIds: [] };
const adminOf = (...ids: string[]) => ({ isPlatformAdmin: false, adminOfOrganizationIds: ids });

let counter = 0;
const unique = (label: string) => `${label} ${++counter} ${randomUUID().slice(0, 8)}`;

async function user(
  options: { name?: string; loggedIn?: boolean; platformAdmin?: boolean; deleted?: boolean } = {},
) {
  const name = options.name ?? unique("Persoon");
  const [row] = await db()
    .insert(users)
    .values({
      name,
      email: `${randomUUID()}@example.test`,
      emailVerified: options.loggedIn ?? true,
      lastLoginAt: (options.loggedIn ?? true) ? new Date() : null,
      isPlatformAdmin: options.platformAdmin ?? false,
      deletedAt: options.deleted ? new Date() : null,
    })
    .returning({ id: users.id });
  return { id: row!.id, name };
}

async function organization() {
  const name = unique("Organisatie");
  const [row] = await db().insert(organizations).values({ name }).returning();
  return { id: row!.id, name };
}

async function workingGroup(organizationId: string, options: { active?: boolean } = {}) {
  const name = unique("Werkgroep");
  const [row] = await db()
    .insert(workingGroups)
    .values({ organizationId, name, city: "Voorbeeldstad", active: options.active ?? true })
    .returning();
  return { id: row!.id, name };
}

async function member(userId: string, workingGroupId: string) {
  await db().insert(workingGroupMemberships).values({ userId, workingGroupId });
}

async function organizationAdmin(userId: string, organizationId: string) {
  await db().insert(organizationAdmins).values({ userId, organizationId });
}

async function request(userId: string, workingGroupId: string, status: "pending" | "approved") {
  const id = randomUUID();
  await db()
    .insert(membershipRequests)
    .values({ id, userId, workingGroupId, status, requestedAt: new Date() });
  return id;
}

async function audit(entry: AuditEntry) {
  await db().transaction((tx) => recordAudit(tx, entry));
}

const byUser = (userId: string) => ({ kind: "user", userId }) as const;
const aboutUser = (id: string) => ({ type: "user", id }) as const;

/** Inserts `count` entries in the organization at the given moments (SQL text), returns nothing. */
async function insertAt(organizationId: string, moments: string[]) {
  for (const moment of moments) {
    await t!.pool.query(
      `insert into audit_log_entries (occurred_at, actor_kind, organization_id, action, subject_type, subject_id)
       values ($1::timestamptz, 'system', $2, 'organization.updated', 'organization', $2)`,
      [moment, organizationId],
    );
  }
}

/** The IDs of the organization's entries, newest first, as the database orders them. */
async function idsInOrder(organizationId: string): Promise<string[]> {
  const { rows } = await t!.pool.query(
    "select id from audit_log_entries where organization_id = $1 order by occurred_at desc, id desc",
    [organizationId],
  );
  return rows.map((row: { id: string }) => row.id);
}

async function readAll(
  access: Parameters<typeof listAuditLogEntries>[1],
  input: Parameters<typeof listAuditLogEntries>[2],
) {
  const pages: AuditLogPage[] = [];
  let cursor = input.cursor;
  do {
    const page = await listAuditLogEntries(db(), access, { ...input, cursor });
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && pages.length < 100);
  return pages;
}

const only = async (access: Parameters<typeof listAuditLogEntries>[1], organizationId: string) =>
  (await listAuditLogEntries(db(), access, { organizationId, limit: 1000 })).entries;

test("newest first, 50 at a time, and no cursor after the last page", async () => {
  const org = await organization();
  await t!.pool.query(
    `insert into audit_log_entries (occurred_at, actor_kind, organization_id, action, subject_type, subject_id)
     select timestamptz '2026-11-25T12:00:00Z' + make_interval(secs => i), 'system', $1, 'organization.updated', 'organization', $1
     from generate_series(1, 120) as i`,
    [org.id],
  );
  const pages = await readAll(platform, { organizationId: org.id });
  expect(pages.map((page) => page.entries.length)).toEqual([50, 50, 20]);
  expect(pages.map((page) => page.nextCursor === null)).toEqual([false, false, true]);
  expect(pages.flatMap((page) => page.entries.map((entry) => entry.id))).toEqual(
    await idsInOrder(org.id),
  );
  expect(pages[0]!.entries[0]!.occurredAt).toBe("2026-11-25T12:02:00.000Z");
  expect(pages[0]!.nextCursor).toMatch(
    /^2026-11-25T12:01:11\.000000Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
});

test("entries of one moment and entries microseconds apart each appear exactly once", async () => {
  const org = await organization();
  await insertAt(org.id, [
    "2026-11-25T12:00:00.123456Z",
    "2026-11-25T12:00:00.123456Z",
    "2026-11-25T12:00:00.123456Z",
    "2026-11-25T12:00:00.123457Z",
    "2026-11-25T12:00:00.123999Z",
  ]);
  const pages = await readAll(platform, { organizationId: org.id, limit: 2 });
  expect(pages.map((page) => page.entries.length)).toEqual([2, 2, 1]);
  const ids = pages.flatMap((page) => page.entries.map((entry) => entry.id));
  expect(new Set(ids).size).toBe(5);
  expect(ids).toEqual(await idsInOrder(org.id));
});

test("an entry written between two pages does not shift the next page", async () => {
  const org = await organization();
  await insertAt(org.id, [
    "2026-11-25T12:00:01Z",
    "2026-11-25T12:00:02Z",
    "2026-11-25T12:00:03Z",
    "2026-11-25T12:00:04Z",
    "2026-11-25T12:00:05Z",
  ]);
  const before = await idsInOrder(org.id);
  const first = await listAuditLogEntries(db(), platform, { organizationId: org.id, limit: 2 });
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "organization.updated",
    subject: { type: "organization", id: org.id },
  });
  const rest = await readAll(platform, {
    organizationId: org.id,
    limit: 2,
    cursor: first.nextCursor!,
  });
  expect([...first.entries, ...rest.flatMap((page) => page.entries)].map((e) => e.id)).toEqual(
    before,
  );
});

test("the group membership holds membership.* and membership_request.*, and no role.*", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const person = await user();
  const requestId = await request(person.id, group.id, "approved");
  const entry = (action: AuditEntry["action"], subject: AuditEntry["subject"]) =>
    audit({
      actor: { kind: "system" },
      organizationId: org.id,
      action,
      subject,
      details: { workingGroupId: group.id },
    });
  await entry("membership.added", aboutUser(person.id));
  await entry("membership.invited", aboutUser(person.id));
  await entry("membership.removed", aboutUser(person.id));
  await entry("membership_request.approved", { type: "membership_request", id: requestId });
  await entry("membership_request.rejected", { type: "membership_request", id: requestId });
  await entry("role.coordinator_granted", aboutUser(person.id));
  await entry("working_group.created", { type: "working_group", id: group.id });
  const actions = async (actionGroup: "membership" | "role" | "workingGroup") =>
    (
      await listAuditLogEntries(db(), platform, { organizationId: org.id, actionGroup })
    ).entries.map((e) => e.action);
  expect((await actions("membership")).sort()).toEqual([
    "membership.added",
    "membership.invited",
    "membership.removed",
    "membership_request.approved",
    "membership_request.rejected",
  ]);
  expect(await actions("role")).toEqual(["role.coordinator_granted"]);
  expect(await actions("workingGroup")).toEqual(["working_group.created"]);
});

test("an organization admin gets the entries of their organization and none without one", async () => {
  const mine = await organization();
  const other = await organization();
  const add = (organizationId: string | null) =>
    audit({
      actor: { kind: "system" },
      organizationId,
      action: "organization.updated",
      subject: { type: "organization", id: organizationId ?? mine.id },
    });
  await add(mine.id);
  await add(mine.id);
  await add(other.id);
  await add(null);
  const page = await listAuditLogEntries(db(), adminOf(mine.id), { limit: 1000 });
  expect(page.entries.map((entry) => entry.organization)).toEqual([
    { id: mine.id, name: mine.name },
    { id: mine.id, name: mine.name },
  ]);
  const both = await listAuditLogEntries(db(), adminOf(mine.id, other.id), { limit: 1000 });
  expect(both.entries).toHaveLength(3);
  expect(both.entries.every((entry) => entry.organization !== null)).toBe(true);
  // A platform admin also gets the entry without an organization.
  const all = await listAuditLogEntries(db(), platform, { limit: 10_000 });
  expect(all.entries.some((entry) => entry.organization === null)).toBe(true);
});

test("an organization admin reads a passkey.reset of their organization, and no passkey entry without one", async () => {
  const mine = await organization();
  const subject = await user();
  const actor = await user();
  await audit({
    actor: byUser(actor.id),
    organizationId: mine.id,
    action: "passkey.reset",
    subject: aboutUser(subject.id),
  });
  await audit({
    actor: byUser(subject.id),
    organizationId: null,
    action: "passkey.added",
    subject: aboutUser(subject.id),
  });
  const entries = (
    await listAuditLogEntries(db(), adminOf(mine.id), { actionGroup: "account", limit: 1000 })
  ).entries;
  expect(entries.map((entry) => entry.action)).toEqual(["passkey.reset"]);
  expect(entries[0]!.organization).toEqual({ id: mine.id, name: mine.name });
});

test("an organizationId outside the scope gives an empty page", async () => {
  const mine = await organization();
  const other = await organization();
  await insertAt(other.id, ["2026-11-25T12:00:00Z"]);
  await expect(
    listAuditLogEntries(db(), adminOf(mine.id), { organizationId: other.id }),
  ).resolves.toEqual({ entries: [], nextCursor: null });
});

test("a coordinator and a volunteer get an empty page", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  await insertAt(org.id, ["2026-11-25T12:00:00Z"]);
  const coordinator = await user();
  const volunteer = await user();
  await db()
    .insert(workingGroupMemberships)
    .values({ userId: coordinator.id, workingGroupId: group.id, isCoordinator: true });
  await member(volunteer.id, group.id);
  for (const person of [coordinator, volunteer]) {
    const access = (await getAccess(db(), person.id))!;
    await expect(listAuditLogEntries(db(), access, {})).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
    await expect(listAuditLogEntries(db(), access, { organizationId: org.id })).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  }
});

test("a platform admin gets every entry and every current name", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const actor = await user();
  const gone = await user();
  await audit({
    actor: byUser(actor.id),
    organizationId: org.id,
    action: "membership.removed",
    subject: aboutUser(gone.id),
    details: { workingGroupId: group.id, role: "volunteer" },
  });
  const [kind] = await db()
    .insert(species)
    .values({ dutchName: unique("soort"), scientificName: unique("Species") })
    .returning();
  await audit({
    actor: byUser(actor.id),
    organizationId: null,
    action: "species.created",
    subject: { type: "species", id: kind!.id },
  });
  // Names are the current ones.
  await db().update(users).set({ name: "Nieuwe naam" }).where(eq(users.id, gone.id));
  await db()
    .update(organizations)
    .set({ name: unique("Hernoemd") })
    .where(eq(organizations.id, org.id));
  await db().update(species).set({ dutchName: "hernoemde soort" }).where(eq(species.id, kind!.id));
  const [renamed] = await db().select().from(organizations).where(eq(organizations.id, org.id));

  const page = await listAuditLogEntries(db(), platform, { limit: 2 });
  expect(page.entries).toEqual([
    {
      id: expect.any(String),
      occurredAt: expect.any(String),
      action: "species.created",
      actor: { kind: "named", name: actor.name, hasLoggedIn: true },
      person: null,
      organization: null,
      workingGroup: null,
      species: { id: kind!.id, dutchName: "hernoemde soort" },
      details: {},
    },
    {
      id: expect.any(String),
      occurredAt: expect.any(String),
      action: "membership.removed",
      actor: { kind: "named", name: actor.name, hasLoggedIn: true },
      person: { kind: "named", name: "Nieuwe naam", hasLoggedIn: true },
      organization: { id: org.id, name: renamed!.name },
      workingGroup: { id: group.id, name: group.name },
      species: null,
      details: { workingGroupId: group.id, role: "volunteer" },
    },
  ]);
});

test("an organization admin gets the name of a member, of someone with a pending request and of an admin of the entry's organization", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const theMember = await user();
  const applicant = await user();
  const admin = await user();
  await member(theMember.id, group.id);
  await request(applicant.id, group.id, "pending");
  await organizationAdmin(admin.id, org.id);
  await audit({
    actor: byUser(admin.id),
    organizationId: org.id,
    action: "membership.added",
    subject: aboutUser(theMember.id),
    details: { workingGroupId: group.id },
  });
  await audit({
    actor: byUser(admin.id),
    organizationId: org.id,
    action: "membership.invited",
    subject: aboutUser(applicant.id),
    details: { workingGroupId: group.id },
  });
  const entries = await only(adminOf(org.id), org.id);
  expect(entries.map((entry) => [entry.actor, entry.person])).toEqual([
    [
      { kind: "named", name: admin.name, hasLoggedIn: true },
      { kind: "named", name: applicant.name, hasLoggedIn: true },
    ],
    [
      { kind: "named", name: admin.name, hasLoggedIn: true },
      { kind: "named", name: theMember.name, hasLoggedIn: true },
    ],
  ]);
  // No user ID, and no email address, in the answer.
  const json = JSON.stringify(entries);
  for (const person of [theMember, applicant, admin]) expect(json).not.toContain(person.id);
  expect(json).not.toContain("@");
});

test("a member of a working group that is switched off is still named", async () => {
  const org = await organization();
  const group = await workingGroup(org.id, { active: false });
  const person = await user();
  await member(person.id, group.id);
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "role.coordinator_revoked",
    subject: aboutUser(person.id),
    details: { workingGroupId: group.id },
  });
  const [entry] = await only(adminOf(org.id), org.id);
  expect(entry!.person).toEqual({ kind: "named", name: person.name, hasLoggedIn: true });
  expect(entry!.workingGroup).toEqual({ id: group.id, name: group.name });
});

test("a removed member is former_member, as the actor and as the person", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const person = await user();
  await audit({
    actor: byUser(person.id),
    organizationId: org.id,
    action: "membership.removed",
    subject: aboutUser(person.id),
    details: { workingGroupId: group.id, role: "volunteer" },
  });
  const entries = await only(adminOf(org.id), org.id);
  expect(entries.map((entry) => [entry.actor, entry.person])).toEqual([
    [{ kind: "former_member" }, { kind: "former_member" }],
  ]);
  expect(JSON.stringify(entries)).not.toContain(person.name);
});

test("someone connected only to another organization the actor administers is former_member in this organization's entry", async () => {
  const here = await organization();
  const there = await organization();
  const thereGroup = await workingGroup(there.id);
  const person = await user();
  await member(person.id, thereGroup.id);
  for (const org of [here, there]) {
    await audit({
      actor: { kind: "system" },
      organizationId: org.id,
      action: "role.organization_admin_revoked",
      subject: aboutUser(person.id),
    });
  }
  const viewer = adminOf(here.id, there.id);
  const [inHere] = await only(viewer, here.id);
  expect(inHere!.person).toEqual({ kind: "former_member" });
  expect(JSON.stringify(inHere)).not.toContain(person.name);
  const [inThere] = await only(viewer, there.id);
  expect(inThere!.person).toEqual({ kind: "named", name: person.name, hasLoggedIn: true });
});

test("a deleted account is deleted_account, also for a platform admin", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const person = await user({ name: "Verwijderd account", deleted: true });
  // A row that still points at the organization does not make a deleted account named.
  await member(person.id, group.id);
  await audit({
    actor: byUser(person.id),
    organizationId: org.id,
    action: "membership.removed",
    subject: aboutUser(person.id),
    details: { workingGroupId: group.id, role: "volunteer" },
  });
  for (const viewer of [platform, adminOf(org.id)]) {
    const [entry] = await only(viewer, org.id);
    expect([entry!.actor, entry!.person]).toEqual([
      { kind: "deleted_account" },
      { kind: "deleted_account" },
    ]);
  }
});

test("the tool is system; a platform admin who is not connected is platform_admin for an organization admin", async () => {
  const org = await organization();
  const staff = await user({ platformAdmin: true });
  const admin = await user();
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "organization.created",
    subject: { type: "organization", id: org.id },
  });
  await audit({
    actor: byUser(staff.id),
    organizationId: org.id,
    action: "role.organization_admin_granted",
    subject: aboutUser(admin.id),
  });
  await organizationAdmin(admin.id, org.id);
  const forAdmin = await only(adminOf(org.id), org.id);
  expect(forAdmin.map((entry) => entry.actor)).toEqual([
    { kind: "platform_admin" },
    { kind: "system" },
  ]);
  expect(JSON.stringify(forAdmin)).not.toContain(staff.name);
  const forStaff = await only(platform, org.id);
  expect(forStaff.map((entry) => entry.actor)).toEqual([
    { kind: "named", name: staff.name, hasLoggedIn: true },
    { kind: "system" },
  ]);
});

test("the person of a decided request is its applicant; the working group comes from the subject or from details", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const elsewhere = await organization();
  const foreignGroup = await workingGroup(elsewhere.id);
  const applicant = await user();
  await member(applicant.id, group.id);
  const requestId = await request(applicant.id, group.id, "approved");
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "working_group.created",
    subject: { type: "working_group", id: group.id },
  });
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "membership_request.approved",
    subject: { type: "membership_request", id: requestId },
    details: { workingGroupId: group.id },
  });
  // A group of another organization in details: shown to a platform admin only.
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "role.coordinator_granted",
    subject: aboutUser(applicant.id),
    details: { workingGroupId: foreignGroup.id },
  });
  const forAdmin = await only(adminOf(org.id), org.id);
  expect(forAdmin.map((entry) => [entry.action, entry.person, entry.workingGroup])).toEqual([
    ["role.coordinator_granted", { kind: "named", name: applicant.name, hasLoggedIn: true }, null],
    [
      "membership_request.approved",
      { kind: "named", name: applicant.name, hasLoggedIn: true },
      { id: group.id, name: group.name },
    ],
    ["working_group.created", null, { id: group.id, name: group.name }],
  ]);
  expect(JSON.stringify(forAdmin)).not.toContain(foreignGroup.name);
  const forStaff = await only(platform, org.id);
  expect(forStaff[0]!.workingGroup).toEqual({ id: foreignGroup.id, name: foreignGroup.name });
});

test("a named person who never logged in has hasLoggedIn false and an empty name", async () => {
  const org = await organization();
  const group = await workingGroup(org.id);
  const person = await user({ name: "", loggedIn: false });
  await member(person.id, group.id);
  await audit({
    actor: { kind: "system" },
    organizationId: org.id,
    action: "membership.added",
    subject: aboutUser(person.id),
    details: { workingGroupId: group.id },
  });
  const [entry] = await only(adminOf(org.id), org.id);
  expect(entry!.person).toEqual({ kind: "named", name: "", hasLoggedIn: false });
});

test("a page of 50 takes as many queries as a page of 5", async () => {
  const org = await organization();
  for (let i = 0; i < 50; i++) {
    const group = await workingGroup(org.id);
    const person = await user();
    await member(person.id, group.id);
    const [kind] = await db()
      .insert(species)
      .values({ dutchName: unique("soort"), scientificName: unique("Species") })
      .returning();
    await audit({
      actor: byUser(person.id),
      organizationId: org.id,
      action: i % 2 === 0 ? "membership.added" : "species.updated",
      subject: i % 2 === 0 ? aboutUser(person.id) : { type: "species", id: kind!.id },
      details: { workingGroupId: group.id },
    });
  }
  const queries = async (limit: number) => {
    const spy = vi.spyOn(t!.pool, "query");
    try {
      const page = await listAuditLogEntries(db(), adminOf(org.id), {
        organizationId: org.id,
        limit,
      });
      expect(page.entries).toHaveLength(limit);
      expect(page.entries.some((entry) => entry.species !== null)).toBe(true);
      expect(page.entries.some((entry) => entry.person !== null)).toBe(true);
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  };
  const five = await queries(5);
  expect(five).toBe(4);
  expect(await queries(50)).toBe(five);
});
