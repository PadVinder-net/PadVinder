import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "@padvinder/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildApp } from "../app";
import type { ApiEnv } from "../env";
import { createMemoryMailer, createMemoryMailQueue } from "@padvinder/mail";
import { createNoopNotificationHub } from "../realtime/notification-hub";
import { testEnv } from "../test-env";

const html = { accept: "text/html" };
const root = await mkdtemp(join(tmpdir(), "padvinder-static-"));
const mobileDir = join(root, "mobile");
const portalDir = join(root, "portal");

async function makeApp(env: ApiEnv) {
  // These routes never touch the database, so a never-connected pool is enough.
  const { db, pool } = createDb("postgres://padvinder:padvinder@127.0.0.1:1/none");
  const app = await buildApp({
    env,
    db,
    notifications: createNoopNotificationHub(),
    mailer: createMemoryMailer(),
    queueMail: createMemoryMailQueue().queueMail,
  });
  return { app, close: async () => (await app.close(), await pool.end()) };
}

describe("with both builds", () => {
  let app: FastifyInstance;
  let close: () => Promise<void>;

  beforeAll(async () => {
    await mkdir(join(mobileDir, "assets"), { recursive: true });
    await mkdir(join(portalDir, "assets"), { recursive: true });
    await writeFile(join(mobileDir, "index.html"), "<p>mobile-index</p>");
    await writeFile(join(mobileDir, "sw.js"), "// sw");
    await writeFile(join(mobileDir, "manifest.webmanifest"), "{}");
    await writeFile(join(mobileDir, "assets", "app.js"), "// app");
    await writeFile(join(mobileDir, ".secret"), "secret");
    await writeFile(join(portalDir, "index.html"), "<p>portal-index</p>");
    await writeFile(join(portalDir, "assets", "portal.js"), "// portal");
    ({ app, close } = await makeApp({
      ...testEnv,
      MOBILE_DIST_DIR: mobileDir,
      PORTAL_DIST_DIR: portalDir,
    }));
  });
  afterAll(async () => {
    await close();
    await rm(root, { recursive: true, force: true });
  });

  test.each([
    ["/app/", "mobile-index"],
    ["/app/more", "mobile-index"],
    ["/app/more/deep", "mobile-index"],
    ["/", "portal-index"],
    ["/system", "portal-index"],
  ])("GET %s serves %s", async (url, marker) => {
    const response = await app.inject({ url, headers: html });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(marker);
  });

  test("index.html served by the fallback is not cached", async () => {
    const response = await app.inject({ url: "/app/more", headers: html });
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  test("GET /app redirects to /app/ and keeps the query string", async () => {
    const response = await app.inject({ url: "/app?x=1" });
    expect(response.statusCode).toBe(308);
    expect(response.headers.location).toBe("/app/?x=1");
  });

  test("a request without text/html in Accept gets a 404 for an unknown path", async () => {
    expect(
      (await app.inject({ url: "/app/more", headers: { accept: "application/json" } })).statusCode,
    ).toBe(404);
    expect((await app.inject({ url: "/system" })).statusCode).toBe(404);
  });

  test("missing asset under /app/ is 404, not HTML", async () => {
    const response = await app.inject({ url: "/app/assets/missing.js", headers: html });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).not.toContain("text/html");
  });

  test("POST to an unknown path is a 404, not HTML", async () => {
    const response = await app.inject({ method: "POST", url: "/system", headers: html });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).not.toContain("text/html");
  });

  test("unknown /api path is a JSON 404, also when the client accepts HTML", async () => {
    const response = await app.inject({ url: "/api/nope", headers: html });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  test("the API still works", async () => {
    expect((await app.inject("/api/version")).statusCode).toBe(200);
  });

  test.each([["/app/sw.js"], ["/app/manifest.webmanifest"], ["/app/index.html"], ["/app/"], ["/"]])(
    "%s is not cached",
    async (url) => {
      expect((await app.inject(url)).headers["cache-control"]).toBe("no-cache");
    },
  );

  test.each([["/app/assets/app.js"], ["/assets/portal.js"]])(
    "hashed asset %s is cached for a year",
    async (url) => {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    },
  );

  test("dotfiles are not served", async () => {
    expect((await app.inject({ url: "/app/.secret" })).statusCode).toBe(404);
    // A browser navigation gets the index (a client route), never the file.
    expect((await app.inject({ url: "/app/.secret", headers: html })).body).not.toContain("secret");
  });

  test("a directory is not listed", async () => {
    const response = await app.inject({ url: "/app/assets/" });
    expect(response.statusCode).toBe(404);
  });

  test("a GET with a foreign Origin still gets the portal", async () => {
    const response = await app.inject({
      url: "/",
      headers: { ...html, origin: "https://evil.example" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("portal-index");
  });
});

describe("without dist dirs", () => {
  test("/ and /app/ are 404 (dev and test default)", async () => {
    const { app, close } = await makeApp(testEnv);
    expect((await app.inject({ url: "/", headers: html })).statusCode).toBe(404);
    expect((await app.inject({ url: "/app/", headers: html })).statusCode).toBe(404);
    expect((await app.inject("/api/version")).statusCode).toBe(200);
    await close();
  });
});

describe("with only the portal build", () => {
  test("/app/ is a 404", async () => {
    const dir = await mkdtemp(join(tmpdir(), "padvinder-portal-"));
    await writeFile(join(dir, "index.html"), "<p>portal-index</p>");
    const { app, close } = await makeApp({ ...testEnv, PORTAL_DIST_DIR: dir });
    expect((await app.inject({ url: "/app/more", headers: html })).statusCode).toBe(404);
    expect((await app.inject({ url: "/more", headers: html })).body).toContain("portal-index");
    await close();
    await rm(dir, { recursive: true, force: true });
  });
});
