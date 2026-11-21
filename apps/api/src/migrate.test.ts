import { resolve } from "node:path";
import { expect, test } from "vitest";
import { parseMigrateArgs } from "./migrate";

test("requires the migrations folder", () =>
  expect(() => parseMigrateArgs([])).toThrow("Usage: node dist/migrate.js <migrations-folder>"));

test("resolves the folder to an absolute path", () =>
  expect(parseMigrateArgs(["migrations"]).migrationsFolder).toBe(resolve("migrations")));

test("keeps an absolute folder", () =>
  expect(parseMigrateArgs(["/srv/release/migrations"]).migrationsFolder).toBe(
    "/srv/release/migrations",
  ));
