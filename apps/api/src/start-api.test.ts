import { createServer } from "node:net";
import { createTestDatabase, startStallingProxy, type TestDatabase } from "@padvinder/db/testing";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { testEnv } from "./test-env";
import { startApi } from "./start-api";

let t: TestDatabase | undefined;
// A clone, not the template: the hub holds a LISTEN connection, and CREATE DATABASE ... TEMPLATE
// in other test files fails while the template has a connection.
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test("rejects and cleans up when the port is taken", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const { port } = blocker.address() as { port: number };
  // Pino writes to stdout; capture it so the test output stays clean and we can check the log.
  const written: string[] = [];
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    await expect(
      startApi({
        ...testEnv,
        DATABASE_URL: t!.url,
        API_HOST: "127.0.0.1",
        API_PORT: port,
        LOG_LEVEL: "error",
      }),
    ).rejects.toThrow(/EADDRINUSE/);
    expect(written.join("")).toContain("API failed to start");
  } finally {
    stdout.mockRestore();
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("serves requests and stops cleanly", async () => {
  const port = await freePort();
  const api = await startApi({
    ...testEnv,
    DATABASE_URL: t!.url,
    API_HOST: "127.0.0.1",
    API_PORT: port,
    LOG_LEVEL: "error",
  });
  const res = await fetch(`http://127.0.0.1:${port}/api/version`);
  expect(res.status).toBe(200);
  await api.stop();
  await expect(fetch(`http://127.0.0.1:${port}/api/version`)).rejects.toThrow();
});

test("starts while the database is down and reports it in /api/health", async () => {
  const port = await freePort();
  const api = await startApi({
    ...testEnv,
    DATABASE_URL: "postgres://padvinder:padvinder@127.0.0.1:1/none",
    API_HOST: "127.0.0.1",
    API_PORT: port,
    LOG_LEVEL: "error",
  });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(res.status).toBe(503);
    expect((await res.json()).database.reachable).toBe(false);
  } finally {
    await api.stop();
  }
});

test("listens within 5 s while the database hangs", async () => {
  const proxy = await startStallingProxy(t!.url);
  proxy.stall();
  const port = await freePort();
  const started = Date.now();
  const api = await startApi({
    ...testEnv,
    DATABASE_URL: proxy.url,
    API_HOST: "127.0.0.1",
    API_PORT: port,
    LOG_LEVEL: "error",
  });
  try {
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(api.app.server.listening).toBe(true);
  } finally {
    await api.stop().catch(() => {});
    await proxy.close();
  }
}, 15_000);
