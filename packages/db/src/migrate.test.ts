import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runMigrations } from "./migrate";
import { createTestDatabase, type TestDatabase } from "./testing";

let t: TestDatabase | undefined;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

test("runs twice without error", async () => {
  await runMigrations(t!.url);
  await expect(runMigrations(t!.url)).resolves.toBeUndefined();
});

test("runs migrations without a statement timeout", async () => {
  const folder = await mkdtemp(join(tmpdir(), "padvinder-migrations-"));
  try {
    await mkdir(join(folder, "20990101000000_probe"));
    // Fails on purpose, so the probe leaves no row in the migrations table.
    await writeFile(
      join(folder, "20990101000000_probe", "migration.sql"),
      `DO $$ BEGIN
  IF current_setting('statement_timeout') <> '0' THEN
    RAISE EXCEPTION 'statement_timeout is set';
  END IF;
  RAISE EXCEPTION 'probe finished';
END $$;`,
    );
    await expect(runMigrations(t!.url, folder)).rejects.toThrow(/probe finished/);
  } finally {
    await rm(folder, { recursive: true });
  }
});

test("rejects a folder without migrations", async () => {
  const empty = await mkdtemp(join(tmpdir(), "no-migrations-"));
  try {
    await expect(runMigrations(t!.url, empty)).rejects.toThrow(`No migrations found in ${empty}`);
  } finally {
    await rm(empty, { recursive: true });
  }
});

test("rejects a folder that does not exist", async () => {
  const missing = join(tmpdir(), "padvinder-missing-migrations");
  await expect(runMigrations(t!.url, missing)).rejects.toThrow(`No migrations found in ${missing}`);
});

test("rejects a folder without migrations before connecting", async () => {
  const missing = join(tmpdir(), "padvinder-missing-migrations");
  // Port 1 refuses connections, so a connection attempt would fail with another error.
  await expect(runMigrations("postgres://x:y@127.0.0.1:1/none", missing)).rejects.toThrow(
    /No migrations found/,
  );
});
