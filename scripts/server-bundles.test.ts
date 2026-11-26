import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// Sentry must start before `pg`, `fastify` and the rest are loaded, or they are not instrumented.
// main.ts of the API and the worker imports only @padvinder/monitoring and loads the program
// with `await import("./run")`. The bundle hoists every static import to the top of its chunk,
// so this builds both apps with their own tsdown config and checks what dist/main.js loads
// before its first line runs: its static imports, and those of every chunk they reach.

const root = join(import.meta.dirname, "..");
const LOADED_AFTER_SENTRY = [
  "pg",
  "pg-boss",
  "drizzle-orm",
  "fastify",
  "better-auth",
  "nodemailer",
];

/** The specifiers of a chunk's static `import … from "x"`, `import "x"` and `export … from "x"`. */
function staticImports(code: string): string[] {
  const pattern = /^\s*(?:import|export)\b[^;"'()]*?(?:\bfrom\s*)?["']([^"']+)["']/gm;
  return [...code.matchAll(pattern)].map((match) => match[1]!);
}

/** Every package `main.js` loads statically, through its own chunks. */
async function packagesLoadedBy(dir: string): Promise<Set<string>> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const visit = async (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of staticImports(await readFile(join(dir, file), "utf8"))) {
      if (specifier.startsWith("./")) await visit(specifier.slice(2));
      else packages.add(specifier);
    }
  };
  await visit("main.js");
  return packages;
}

function isLoadedAfterSentry(specifier: string): boolean {
  return LOADED_AFTER_SENTRY.some((name) => specifier === name || specifier.startsWith(`${name}/`));
}

test("staticImports finds the static imports and skips dynamic ones", () => {
  const code = [
    'import { a } from "./chunk-a.js";',
    "import pg from 'pg';",
    'import "./side-effect.js";',
    'import {\n  b,\n  c\n} from "drizzle-orm/pg-core";',
    'export { d } from "./chunk-d.js";',
    'const { run } = await import("./run.js");',
  ].join("\n");
  expect(staticImports(code)).toEqual([
    "./chunk-a.js",
    "pg",
    "./side-effect.js",
    "drizzle-orm/pg-core",
    "./chunk-d.js",
  ]);
});

describe.each(["api", "worker"])("the %s bundle", (app) => {
  let out: string;
  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), `padvinder-${app}-bundle-`));
    const appDir = join(root, "apps", app);
    execFileSync(
      join(appDir, "node_modules/.bin/tsdown"),
      ["--out-dir", out, "--logLevel", "error"],
      {
        cwd: appDir,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
  }, 60_000);
  afterAll(() => rm(out, { recursive: true, force: true }));

  test("main.js loads Sentry, and nothing it must instrument, before its first line", async () => {
    const packages = await packagesLoadedBy(out);
    expect(packages).toContain("@sentry/node");
    expect([...packages].filter(isLoadedAfterSentry)).toEqual([]);
  });
});
