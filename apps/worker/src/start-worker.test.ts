import { expect, test, vi } from "vitest";
import type { Logger } from "./logger";
import { startWorker } from "./start-worker";

test("logs and rejects when the database is unreachable", async () => {
  const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  await expect(
    startWorker(
      { DATABASE_URL: "postgres://padvinder:padvinder@127.0.0.1:1/none", LOG_LEVEL: "info" },
      logger,
    ),
  ).rejects.toThrow();
  expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/start/i), expect.anything());
});
