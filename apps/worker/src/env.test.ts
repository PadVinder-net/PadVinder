import { expect, test } from "vitest";
import { loadWorkerEnv } from "./env";

test("names the missing variable", () => expect(() => loadWorkerEnv({})).toThrow(/DATABASE_URL/));

test("defaults LOG_LEVEL to info", () =>
  expect(loadWorkerEnv({ DATABASE_URL: "postgres://x" })).toEqual({
    DATABASE_URL: "postgres://x",
    LOG_LEVEL: "info",
  }));

test("rejects an unknown LOG_LEVEL", () =>
  expect(() => loadWorkerEnv({ DATABASE_URL: "postgres://x", LOG_LEVEL: "loud" })).toThrow(
    /LOG_LEVEL/,
  ));

test("names every problem at once, each with its variable", () =>
  expect(() => loadWorkerEnv({ LOG_LEVEL: "loud" })).toThrow(
    /^Invalid worker environment: DATABASE_URL: .+; LOG_LEVEL: .+/,
  ));

test("an empty value counts as not set", () => {
  expect(() => loadWorkerEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  expect(loadWorkerEnv({ DATABASE_URL: "postgres://x", LOG_LEVEL: "" }).LOG_LEVEL).toBe("info");
});
