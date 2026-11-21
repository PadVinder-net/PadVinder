import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { diffSnapshots, snapshotFiles } from "./file-snapshot.ts";

let dir: string;

async function put(path: string, content: string) {
  const full = join(dir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "file-snapshot-"));
  await put("gen/a.json", "{}");
  await put("gen/b.ts", "export {};");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("an untouched tree has no differences", async () => {
  const a = await snapshotFiles(dir, ["gen"]);
  expect(diffSnapshots(a, await snapshotFiles(dir, ["gen"]))).toEqual({
    added: [],
    changed: [],
    removed: [],
  });
});

test("reports a new file in a new subfolder as added", async () => {
  const before = await snapshotFiles(dir, ["gen"]);
  await put("gen/20270101_new/migration.sql", "select 1;");
  expect(diffSnapshots(before, await snapshotFiles(dir, ["gen"])).added).toEqual([
    "gen/20270101_new/migration.sql",
  ]);
});

test("reports changed and removed files", async () => {
  const before = await snapshotFiles(dir, ["gen"]);
  await put("gen/a.json", '{"a":1}');
  await rm(join(dir, "gen/b.ts"));
  expect(diffSnapshots(before, await snapshotFiles(dir, ["gen"]))).toEqual({
    added: [],
    changed: ["gen/a.json"],
    removed: ["gen/b.ts"],
  });
});

test("a single file path is snapshotted too", async () => {
  expect([...(await snapshotFiles(dir, ["gen/a.json"])).keys()]).toEqual(["gen/a.json"]);
});

test("a missing path is empty, not an error", async () => {
  expect((await snapshotFiles(dir, ["nope"])).size).toBe(0);
});
