import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

// The visual tests run in the Playwright Docker image. Its browsers only work with
// the Playwright version the image was built for, so the tag must follow the package.
const PLAYWRIGHT_IMAGE_PATTERN = /mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble/g;

const root = join(import.meta.dirname, "..");

function read(path: string): Promise<string> {
  return readFile(join(root, path), "utf8");
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await read(path)) as Record<string, unknown>;
}

async function files(pattern: string): Promise<string[]> {
  const found: string[] = [];
  for await (const path of glob(pattern, { cwd: root })) found.push(path);
  return found.sort();
}

function devDependency(manifest: Record<string, unknown>, name: string): string | undefined {
  return (manifest.devDependencies as Record<string, string> | undefined)?.[name];
}

test("every Playwright image tag matches the installed Playwright", async () => {
  const installed = (await readJson("node_modules/@playwright/test/package.json")).version;
  const paths = [...(await files(".github/workflows/*.yml")), ...(await files("scripts/*.sh"))];
  const tags = (
    await Promise.all(
      paths.map(async (path) =>
        [...(await read(path)).matchAll(PLAYWRIGHT_IMAGE_PATTERN)].map((m) => ({
          path,
          version: m[1],
        })),
      ),
    )
  ).flat();

  expect(tags.length).toBeGreaterThan(0);
  for (const { path, version } of tags) {
    expect(
      version,
      `${path} uses the Playwright ${version} image, but @playwright/test is ${installed}. Change the tag in ${path}.`,
    ).toBe(installed);
  }
});

test("@playwright/test and playwright are pinned exactly to the same version", async () => {
  const rootManifest = await readJson("package.json");
  const uiManifest = await readJson("packages/ui/package.json");
  const pins = [
    {
      where: "package.json",
      name: "@playwright/test",
      spec: devDependency(rootManifest, "@playwright/test"),
    },
    {
      where: "packages/ui/package.json",
      name: "playwright",
      spec: devDependency(uiManifest, "playwright"),
    },
  ];

  for (const { where, name, spec } of pins) {
    expect(spec, `${where} has no devDependency ${name}.`).toBeDefined();
    expect(spec, `${where} must pin ${name} exactly, without ^ or ~.`).toMatch(/^\d+\.\d+\.\d+$/);
  }
  expect(pins[1]?.spec, "playwright and @playwright/test must have the same version.").toBe(
    pins[0]?.spec,
  );
});
