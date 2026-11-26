import { afterAll, beforeAll, expect, test } from "vitest";
import { users } from "./schema";
import { createTestDatabase, type TestDatabase } from "./testing";
import { findUserNameByEmail, getUserProfile, updateUserProfile } from "./users";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

async function insertUser(email: string): Promise<string> {
  const [row] = await t!.db
    .insert(users)
    .values({ name: "", email, emailVerified: true })
    .returning({ id: users.id });
  return row!.id;
}

test("a new user has an empty name and no phone", async () => {
  const id = await insertUser("empty@example.test");
  expect(await getUserProfile(t!.db, id)).toEqual({
    id,
    name: "",
    email: "empty@example.test",
    phone: null,
  });
});

test("a patch changes only the given keys", async () => {
  const id = await insertUser("patch@example.test");
  await updateUserProfile(t!.db, id, { name: "Noor de Vries" });
  expect(await getUserProfile(t!.db, id)).toMatchObject({ name: "Noor de Vries", phone: null });
  await updateUserProfile(t!.db, id, { phone: "06 12345678" });
  expect(await getUserProfile(t!.db, id)).toMatchObject({
    name: "Noor de Vries",
    phone: "06 12345678",
  });
  await updateUserProfile(t!.db, id, { phone: null });
  expect((await getUserProfile(t!.db, id))?.phone).toBeNull();
  expect((await getUserProfile(t!.db, id))?.name).toBe("Noor de Vries");
});

test("an empty patch returns the profile unchanged", async () => {
  const id = await insertUser("nochange@example.test");
  expect(await updateUserProfile(t!.db, id, {})).toMatchObject({ email: "nochange@example.test" });
});

test("an unknown user is null", async () => {
  expect(await getUserProfile(t!.db, "0193a5e0-0000-7000-8000-000000000000")).toBeNull();
});

test("updating an unknown user is null, not an error", async () => {
  const unknown = "0193a5e0-0000-7000-8000-000000000000";
  expect(await updateUserProfile(t!.db, unknown, { name: "Niemand" })).toBeNull();
  expect(await updateUserProfile(t!.db, unknown, {})).toBeNull();
});

test("two users cannot share an email address", async () => {
  await insertUser("same@example.test");
  await expect(insertUser("same@example.test")).rejects.toThrow();
});

test("findUserNameByEmail gives the name of the account with that address", async () => {
  await t!.db.insert(users).values({ name: "Noor", email: "find-noor@example.test" });
  expect(await findUserNameByEmail(t!.db, "find-noor@example.test")).toBe("Noor");
  expect(await findUserNameByEmail(t!.db, " Find-Noor@Example.test ")).toBe("Noor");
});

test("findUserNameByEmail is null for an unknown address and for a deleted account", async () => {
  expect(await findUserNameByEmail(t!.db, "nobody@example.test")).toBeNull();
  await t!.db
    .insert(users)
    .values({ name: "Verwijderd account", email: "find-gone@example.test", deletedAt: new Date() });
  expect(await findUserNameByEmail(t!.db, "find-gone@example.test")).toBeNull();
});
