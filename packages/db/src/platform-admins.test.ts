import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { deleteAccount } from "./accounts";
import { grantPlatformAdmin } from "./admin";
import type { AuditActor } from "./audit-log";
import { listPlatformAdmins } from "./platform-admins";
import { users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";

const system: AuditActor = { kind: "system" };
let t: TestDatabase | undefined;
const db = () => t!.db;

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

/** A platform admin with a name; `loggedIn` sets what the first login sets. */
async function platformAdmin(email: string, name: string, loggedIn: boolean): Promise<string> {
  const { userId } = await grantPlatformAdmin(db(), { email }, system);
  await db()
    .update(users)
    .set({
      name,
      ...(loggedIn ? { emailVerified: true, lastLoginAt: new Date() } : {}),
    })
    .where(eq(users.id, userId));
  return userId;
}

test("lists the platform admins by name, with hasLoggedIn", async () => {
  const zeger = await platformAdmin("zeger@example.test", "Zeger", true);
  const eva = await platformAdmin("eva@example.test", "Éva", true);
  const anna2 = await platformAdmin("anna-b@example.test", "Anna", true);
  const anna1 = await platformAdmin("anna-a@example.test", "Anna", false);
  const nameless = await platformAdmin("nieuw@example.test", "", false);
  // Not listed: someone without the flag, and a deleted account.
  await db().insert(users).values({ name: "Aart", email: "aart@example.test" });
  const leaving = await platformAdmin("weg@example.test", "Bert", true);
  expect(await deleteAccount(db(), { userId: leaving, now: new Date() })).toMatchObject({
    outcome: "deleted",
  });
  // A deleted row that still has the flag (deletion clears it) is left out too.
  await db().insert(users).values({
    name: "Verwijderd account",
    email: "deleted-x@deleted.invalid",
    isPlatformAdmin: true,
    deletedAt: new Date(),
  });

  expect(await listPlatformAdmins(db())).toEqual([
    { userId: nameless, name: "", email: "nieuw@example.test", hasLoggedIn: false },
    { userId: anna1, name: "Anna", email: "anna-a@example.test", hasLoggedIn: false },
    { userId: anna2, name: "Anna", email: "anna-b@example.test", hasLoggedIn: true },
    { userId: eva, name: "Éva", email: "eva@example.test", hasLoggedIn: true },
    { userId: zeger, name: "Zeger", email: "zeger@example.test", hasLoggedIn: true },
  ]);
});
