import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { recordAudit, type AuditDetails } from "./audit-log";
import { auditLogEntries, organizations, users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

const id = "0192f0a0-0000-7000-8000-000000000001";
const entry = {
  actor: { kind: "system" },
  organizationId: null,
  action: "organization.created",
  subject: { type: "organization", id },
} as const;

async function count(): Promise<number> {
  return (await t!.db.select().from(auditLogEntries)).length;
}

test("writes one entry inside the transaction", async () => {
  await t!.db.transaction((tx) => recordAudit(tx, { ...entry, details: { source: "cli" } }));
  expect(await t!.db.select().from(auditLogEntries)).toMatchObject([
    {
      actorKind: "system",
      actorUserId: null,
      organizationId: null,
      action: "organization.created",
      subjectType: "organization",
      subjectId: id,
      details: { source: "cli" },
    },
  ]);
});

test("a user actor and an organization are stored by ID", async () => {
  const [org] = await t!.db.insert(organizations).values({ name: "Org" }).returning();
  const [user] = await t!.db
    .insert(users)
    .values({ name: "", email: "actor@example.test", emailVerified: true })
    .returning();
  await t!.db.transaction((tx) =>
    recordAudit(tx, {
      ...entry,
      actor: { kind: "user", userId: user!.id },
      organizationId: org!.id,
      action: "working_group.created",
    }),
  );
  const rows = await t!.db.select().from(auditLogEntries);
  expect(rows.find((r) => r.actorUserId === user!.id)).toMatchObject({
    actorKind: "user",
    organizationId: org!.id,
    details: {},
  });
});

test("nothing is written when the transaction rolls back", async () => {
  const before = await count();
  await expect(
    t!.db.transaction(async (tx) => {
      await recordAudit(tx, entry);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await count()).toBe(before);
});

test("an entry cannot be updated", async () => {
  await t!.db.transaction((tx) => recordAudit(tx, entry));
  await expect(t!.db.update(auditLogEntries).set({ action: "x" })).rejects.toThrow();
});

test("an entry cannot be deleted", async () => {
  await t!.db.transaction((tx) => recordAudit(tx, entry));
  await expect(t!.db.delete(auditLogEntries)).rejects.toThrow();
});

test("the table cannot be truncated", async () => {
  await t!.db.transaction((tx) => recordAudit(tx, entry));
  await expect(t!.db.execute(sql`truncate audit_log_entries`)).rejects.toThrow();
});

test.each<[AuditDetails]>([
  [{ name: "Noor" }],
  [{ email: "x" }],
  [{ phone: "06" }],
  [{ note: "noor@example.test" }],
])("refuses personal data in details: %j", async (details) => {
  const before = await count();
  await expect(t!.db.transaction((tx) => recordAudit(tx, { ...entry, details }))).rejects.toThrow(
    /personal data/,
  );
  expect(await count()).toBe(before);
});
