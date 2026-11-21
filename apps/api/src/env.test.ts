import { expect, test } from "vitest";
import { loadApiEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://x",
  API_PORT: "4100",
  ALLOWED_ORIGINS: "http://localhost:4101, http://localhost:4102",
};

test("parses a valid environment and applies defaults", () =>
  expect(loadApiEnv(valid)).toEqual({
    DATABASE_URL: "postgres://x",
    API_PORT: 4100,
    API_HOST: "::",
    ALLOWED_ORIGINS: ["http://localhost:4101", "http://localhost:4102"],
    GIT_COMMIT: "dev",
    MIN_APP_VERSION: "2027.0.0",
    LOG_LEVEL: "info",
  }));

test("defaults API_HOST to ::", () => expect(loadApiEnv(valid).API_HOST).toBe("::"));

test("rejects an invalid MIN_APP_VERSION", () =>
  expect(() => loadApiEnv({ ...valid, MIN_APP_VERSION: "1.0" })).toThrow(/MIN_APP_VERSION/));

test("names every problem at once", () =>
  expect(() => loadApiEnv({})).toThrow(/DATABASE_URL.*API_PORT.*ALLOWED_ORIGINS/s));

test("requires at least one allowed origin", () =>
  expect(() => loadApiEnv({ ...valid, ALLOWED_ORIGINS: " , " })).toThrow(/ALLOWED_ORIGINS/));

test("rejects an unknown LOG_LEVEL", () =>
  expect(() => loadApiEnv({ ...valid, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/));

test("rejects a port out of range", () =>
  expect(() => loadApiEnv({ ...valid, API_PORT: "70000" })).toThrow(/API_PORT/));

test("rejects an allowed origin with a trailing slash", () =>
  expect(() => loadApiEnv({ ...valid, ALLOWED_ORIGINS: "http://localhost:4101/" })).toThrow(
    /ALLOWED_ORIGINS/,
  ));

test("rejects an allowed origin with a path", () =>
  expect(() => loadApiEnv({ ...valid, ALLOWED_ORIGINS: "https://app.example/path" })).toThrow(
    /ALLOWED_ORIGINS/,
  ));

test("rejects an allowed origin that is not a URL", () =>
  expect(() => loadApiEnv({ ...valid, ALLOWED_ORIGINS: "localhost:4101" })).toThrow(
    /ALLOWED_ORIGINS/,
  ));
