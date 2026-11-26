import { expect, test } from "vitest";
import {
  auditActionGroups,
  auditActionPrefixes,
  auditActions,
  auditLogCursorSchema,
  auditLogEntrySchema,
  auditLogPageSchema,
  auditLogPersonSchema,
  listAuditLogEntriesQuerySchema,
} from "./audit-log";
import { auditLogFixture } from "./fixtures";

const groupsOf = (action: string) =>
  auditActionGroups.filter((group) =>
    auditActionPrefixes[group].some((prefix) => action.startsWith(prefix)),
  );

test("every action falls in exactly one group", () => {
  expect(auditActions).toHaveLength(25);
  for (const action of auditActions) expect(groupsOf(action)).toHaveLength(1);
});

test("passkey.added, passkey.removed and passkey.reset fall in the group account", () => {
  for (const action of ["passkey.added", "passkey.removed", "passkey.reset"]) {
    expect(groupsOf(action), action).toEqual(["account"]);
  }
});

test("a later action falls into its group by prefix", () => {
  expect(groupsOf("membership.renewed")).toEqual(["membership"]);
  expect(groupsOf("membership_request.withdrawn")).toEqual(["membership"]);
  expect(groupsOf("safety_test.published")).toEqual([]);
});

test("a cursor of a moment with six decimals and a UUID is accepted", () =>
  expect(
    auditLogCursorSchema.parse("2026-11-25T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001"),
  ).toBe("2026-11-25T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001"));

test.each([
  "2026-11-25T19:04:05.123Z_0192f3c0-0000-7000-8000-000000000001",
  "2026-13-45T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001",
  "2026-02-30T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001",
  "2026-11-25T24:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001",
  "2026-11-25T19:04:05.123456+01:00_0192f3c0-0000-7000-8000-000000000001",
  "2026-11-25T19:04:05.123456Z_not-a-uuid",
  "2026-11-25T19:04:05.123456Z",
  "x",
  "",
])("the cursor %j is refused", (cursor) =>
  expect(auditLogCursorSchema.safeParse(cursor).success).toBe(false),
);

test("the fixture parses and holds every action of auditActions", () => {
  const entries = auditLogPageSchema.parse({ entries: auditLogFixture, nextCursor: null }).entries;
  const actions = entries.map((entry) => entry.action);
  for (const action of auditActions) expect(actions).toContain(action);
  expect(actions).toContain("safety_test.published");
  const kinds = new Set(
    entries.flatMap((entry) => [entry.actor.kind, ...(entry.person ? [entry.person.kind] : [])]),
  );
  expect([...kinds].sort()).toEqual(
    ["deleted_account", "former_member", "named", "platform_admin", "system"].sort(),
  );
  const moments = entries.map((entry) => Date.parse(entry.occurredAt));
  expect(moments).toEqual([...moments].sort((a, b) => b - a));
});

test("the fixture holds the short updates", () => {
  const details = (action: string) =>
    auditLogFixture.find((entry) => entry.action === action)!.details;
  expect(details("organization.updated")).toEqual({ contactChanged: true });
  expect(Object.keys(details("working_group.updated")).sort()).toEqual(["cityFrom", "cityTo"]);
  expect(Object.keys(details("species.updated")).sort()).toEqual([
    "needsVerificationFrom",
    "needsVerificationTo",
  ]);
});

test("a named person has a name and hasLoggedIn; the other kinds have neither", () => {
  expect(auditLogPersonSchema.parse({ kind: "named", name: "", hasLoggedIn: false })).toEqual({
    kind: "named",
    name: "",
    hasLoggedIn: false,
  });
  expect(auditLogPersonSchema.safeParse({ kind: "named" }).success).toBe(false);
  expect(auditLogPersonSchema.safeParse({ kind: "named", name: "Anna" }).success).toBe(false);
  expect(auditLogPersonSchema.parse({ kind: "system" })).toEqual({ kind: "system" });
  expect(auditLogPersonSchema.safeParse({ kind: "former_member", name: "Anna" }).success).toBe(
    false,
  );
  expect(
    auditLogPersonSchema.safeParse({ kind: "deleted_account", hasLoggedIn: true }).success,
  ).toBe(false);
  expect(auditLogPersonSchema.safeParse({ kind: "someone" }).success).toBe(false);
});

test("an entry with an action the portal does not know parses", () =>
  expect(
    auditLogEntrySchema.parse({ ...auditLogFixture[0]!, action: "safety_test.revoked" }).action,
  ).toBe("safety_test.revoked"));

test("the query accepts nothing, or the three filters, and nothing else", () => {
  expect(listAuditLogEntriesQuerySchema.parse({})).toEqual({});
  const query = {
    organizationId: "0192f3c0-0000-7000-8000-000000000001",
    actionGroup: "workingGroup",
    cursor: "2026-11-25T19:04:05.123456Z_0192f3c0-0000-7000-8000-000000000001",
  };
  expect(listAuditLogEntriesQuerySchema.parse(query)).toEqual(query);
  expect(listAuditLogEntriesQuerySchema.safeParse({ organizationId: "x" }).success).toBe(false);
  expect(listAuditLogEntriesQuerySchema.safeParse({ actionGroup: "safety" }).success).toBe(false);
  expect(listAuditLogEntriesQuerySchema.safeParse({ cursor: "x" }).success).toBe(false);
  expect(listAuditLogEntriesQuerySchema.safeParse({ limit: "10" }).success).toBe(false);
});
