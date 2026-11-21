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
