import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { organizationAdmins, organizations, users } from "@padvinder/db";
import { createTestDatabase, type TestDatabase } from "@padvinder/db/testing";
import { runAdminCommand } from "./run-admin-command";

let t: TestDatabase | undefined;
let out: string[];
let err: string[];
// A fresh database per test: the audit log cannot be emptied.
beforeEach(async () => {
  t = await createTestDatabase();
  out = [];
  err = [];
});
afterEach(async () => {
  await t?.drop();
});

const run = (...argv: string[]) =>
  runAdminCommand(argv, {
    db: t!.db,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });

async function addUser(email: string) {
  await t!.db.insert(users).values({ email, name: "", emailVerified: true });
}

test("create-organization needs --admin-email and prints the id first", async () => {
  expect(await run("create-organization", "--name", "Paddentrek Voorbeeldstad")).toBe(1);
  expect(err).toEqual([expect.stringContaining("--admin-email")]);
  expect(await t!.db.select().from(organizations)).toEqual([]);
  err.length = 0;
  await addUser("bram@example.test");
  expect(
    await run(
      "create-organization",
      "--name",
      "Paddentrek Voorbeeldstad",
      "--admin-email",
      "Bram@Example.test",
    ),
  ).toBe(0);
  expect(out).toEqual([expect.stringMatching(/^[0-9a-f-]{36}$/)]);
  expect(err).toEqual([]);
  const [admin] = await t!.db.select().from(organizationAdmins);
  expect(admin?.organizationId).toBe(out[0]);
});

test("create-organization says when it made an account", async () => {
  expect(
    await run(
      "create-organization",
      "--name",
      "Paddentrek Voorbeeldstad",
      "--admin-email",
      " Bram@Example.test ",
      "--contact-email",
      "Info@Example.test",
    ),
  ).toBe(0);
  expect(out).toEqual([
    expect.stringMatching(/^[0-9a-f-]{36}$/),
    "new account for bram@example.test",
  ]);
  const [organization] = await t!.db.select().from(organizations);
  expect(organization).toMatchObject({ id: out[0], contactEmail: "info@example.test" });
});

test("create-organization refuses a taken name with one line", async () => {
  await run("create-organization", "--name", "Org", "--admin-email", "a@example.test");
  expect(
    await run("create-organization", "--name", " org ", "--admin-email", "b@example.test"),
  ).toBe(1);
  expect(err).toEqual([expect.stringMatching(/name is already taken/)]);
});

test("revoke-organization-admin refuses the last admin", async () => {
  await run("create-organization", "--name", "Org", "--admin-email", "a@example.test");
  const orgId = out[0]!;
  out.length = 0;
  expect(
    await run("revoke-organization-admin", "--email", "a@example.test", "--organization", orgId),
  ).toBe(1);
  expect(err).toEqual([expect.stringMatching(/last admin/i)]);
  expect(out).toEqual([]);
  expect(await t!.db.select().from(organizationAdmins)).toHaveLength(1);
});

test("list marks an organization without an admin", async () => {
  await run("create-organization", "--name", "Met beheer", "--admin-email", "a@example.test");
  await run("create-organization", "--name", "Zonder beheer", "--admin-email", "b@example.test");
  const withoutId = out[2]!;
  await t!.db.delete(organizationAdmins).where(eq(organizationAdmins.organizationId, withoutId));
  out.length = 0;
  expect(await run("list")).toBe(0);
  expect(out).toContain(`organization ${withoutId} Zonder beheer [no admin]`);
  expect(out.find((line) => line.includes("Met beheer"))).not.toContain("[no admin]");
});

test("create-working-group, grant-coordinator and list work together", async () => {
  await run(
    "create-organization",
    "--name",
    "Paddentrek Voorbeeldstad",
    "--admin-email",
    "beheer@example.test",
  );
  const orgId = out[0]!;
  out.length = 0;
  expect(
    await run(
      "create-working-group",
      "--organization",
      orgId,
      "--name",
      "Noord",
      "--city",
      "Voorbeeldstad",
    ),
  ).toBe(0);
  const groupId = out[0]!;
  expect(groupId).toMatch(/^[0-9a-f-]{36}$/);
  await addUser("co@example.test");
  out.length = 0;
  expect(
    await run("grant-coordinator", "--email", "Co@Example.test", "--working-group", groupId),
  ).toBe(0);
  expect(out).toEqual(["changed"]);
  out.length = 0;
  expect(await run("list")).toBe(0);
  const text = out.join("\n");
  expect(text).toContain("Paddentrek Voorbeeldstad");
  expect(text).toContain("Noord (Voorbeeldstad)");
  expect(text).toContain(orgId);
  expect(text).toContain(groupId);
  expect(text).not.toContain("example.test");
});

test("grant twice prints changed, then unchanged", async () => {
  await addUser("a@example.test");
  await run("grant-platform-admin", "--email", "a@example.test");
  await run("grant-platform-admin", "--email", "a@example.test");
  expect(out).toEqual(["changed", "unchanged"]);
  const [row] = await t!.db.select().from(users).where(eq(users.email, "a@example.test"));
  expect(row?.isPlatformAdmin).toBe(true);
});

test("organization admin grant and revoke", async () => {
  await run("create-organization", "--name", "Org", "--admin-email", "beheer@example.test");
  const orgId = out[0]!;
  await addUser("a@example.test");
  out.length = 0;
  await run("grant-organization-admin", "--email", "a@example.test", "--organization", orgId);
  await run("revoke-organization-admin", "--email", "a@example.test", "--organization", orgId);
  await run("revoke-organization-admin", "--email", "a@example.test", "--organization", orgId);
  expect(out).toEqual(["changed", "changed", "unchanged"]);
});

test("revoking the last platform admin exits 1 with a clear line", async () => {
  await addUser("a@example.test");
  await run("grant-platform-admin", "--email", "a@example.test");
  out.length = 0;
  expect(await run("revoke-platform-admin", "--email", "a@example.test")).toBe(1);
  expect(err.join("\n")).toMatch(/last platform admin/i);
  expect(out).toEqual([]);
});

test("an unknown user exits 1 with one line", async () => {
  expect(await run("revoke-platform-admin", "--email", "nobody@example.test")).toBe(1);
  expect(err).toEqual([expect.stringMatching(/no user with that email/i)]);
});

test("a missing option exits 1 and names the option", async () => {
  expect(await run("create-working-group", "--organization", "x", "--name", "Noord")).toBe(1);
  expect(err.join("\n")).toContain("--city");
});

test("an unknown option exits 1", async () => {
  expect(await run("list", "--bogus")).toBe(1);
  expect(err).toHaveLength(1);
});

test("an unknown command exits 1", async () => {
  expect(await run("frobnicate")).toBe(1);
  expect(err.join("\n")).toContain("frobnicate");
});

test("no command and --help print the help and exit 0", async () => {
  expect(await run()).toBe(0);
  expect(out.join("\n")).toContain("create-working-group");
  out.length = 0;
  expect(await run("--help")).toBe(0);
  expect(out.join("\n")).toContain("grant-coordinator");
  expect(err).toEqual([]);
});

test("a grant for an unknown address says it made a new account", async () => {
  expect(await run("grant-platform-admin", "--email", " New@Example.test ")).toBe(0);
  expect(await run("grant-platform-admin", "--email", "new@example.test")).toBe(0);
  expect(out).toEqual(["changed (new account for new@example.test)", "unchanged"]);
});

test("an invalid address exits 1 and writes nothing", async () => {
  expect(await run("grant-platform-admin", "--email", "not-an-address")).toBe(1);
  expect(err).toEqual([expect.stringMatching(/not a valid email/i)]);
  expect(await t!.db.select().from(users)).toEqual([]);
});

test("an ID option that is not a UUID exits 1 with one line", async () => {
  expect(await run("grant-coordinator", "--email", "a@example.test", "--working-group", "x")).toBe(
    1,
  );
  expect(err).toEqual([expect.stringMatching(/--working-group must be an ID/)]);
});

test("--help warns that grants create accounts", async () => {
  await run("--help");
  expect(out.join("\n")).toMatch(/create the account/);
});
