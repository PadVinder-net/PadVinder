import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** Repo-relative path (forward slashes) to the SHA-256 of the file content. */
export type FileSnapshot = Map<string, string>;

export type SnapshotDiff = { added: string[]; changed: string[]; removed: string[] };

async function addPath(root: string, relative: string, snapshot: FileSnapshot): Promise<void> {
  let info;
  try {
    info = await stat(join(root, relative));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isDirectory()) {
    for (const name of await readdir(join(root, relative))) {
      await addPath(root, `${relative}/${name}`, snapshot);
    }
  } else if (info.isFile()) {
    const content = await readFile(join(root, relative));
    snapshot.set(relative, createHash("sha256").update(content).digest("hex"));
  }
}

/** Hashes every file under each path, recursively. A missing path contributes nothing. */
export async function snapshotFiles(root: string, paths: readonly string[]): Promise<FileSnapshot> {
  const snapshot: FileSnapshot = new Map();
  for (const path of paths) await addPath(root, path.replace(/\/+$/, ""), snapshot);
  return snapshot;
}

export function diffSnapshots(before: FileSnapshot, after: FileSnapshot): SnapshotDiff {
  const added = [...after.keys()].filter((path) => !before.has(path));
  const removed = [...before.keys()].filter((path) => !after.has(path));
  const changed = [...after.keys()].filter(
    (path) => before.has(path) && before.get(path) !== after.get(path),
  );
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}
