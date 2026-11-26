import { resolve } from "node:path";
import { expect, test } from "vitest";
import { loadApiEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://x",
  API_PORT: "4100",
  ALLOWED_ORIGINS: "http://localhost:4101, http://localhost:4102",
  AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
  PUBLIC_ORIGIN: "http://localhost:4101",
  SMTP_HOST: "localhost",
  SMTP_PORT: "54325",
  MAIL_FROM: "PadVinder <noreply@padvinder.test>",
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
    AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
    PUBLIC_ORIGIN: "http://localhost:4101",
    SMTP_HOST: "localhost",
    SMTP_PORT: 54325,
    MAIL_FROM: "PadVinder <noreply@padvinder.test>",
    LOGIN_RATE_LIMITS: "on",
    PADVINDER_ENVIRONMENT: "development",
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

// `new URL` throws on these; the cross-field check must still report the variable, not crash.
test.each([
  ["PUBLIC_ORIGIN", { PUBLIC_ORIGIN: "padvinder.net" }],
  ["ALLOWED_ORIGINS", { ALLOWED_ORIGINS: "padvinder.net" }],
  ["PUBLIC_ORIGIN", { PUBLIC_ORIGIN: "padvinder.net", LOGIN_RATE_LIMITS: "off" }],
])("an unparseable origin names %s", (name, change) =>
  expect(() => loadApiEnv({ ...valid, ...change })).toThrow(
    new RegExp(`^Invalid API environment: (.*; )?${name}(\\.0)?: [^;]*$`),
  ),
);

test("a missing PUBLIC_ORIGIN and ALLOWED_ORIGINS are named, not a crash", () =>
  expect(() =>
    loadApiEnv({ ...valid, PUBLIC_ORIGIN: undefined, ALLOWED_ORIGINS: undefined }),
  ).toThrow(/^Invalid API environment: .*ALLOWED_ORIGINS.*PUBLIC_ORIGIN/));

test("resolves relative dist dirs against the working directory", () => {
  const env = loadApiEnv({ ...valid, MOBILE_DIST_DIR: "mobile", PORTAL_DIST_DIR: "/abs/portal" });
  expect(env.MOBILE_DIST_DIR).toBe(resolve(process.cwd(), "mobile"));
  expect(env.PORTAL_DIST_DIR).toBe("/abs/portal");
});

test("names a missing AUTH_SECRET", () =>
  expect(() => loadApiEnv({ ...valid, AUTH_SECRET: undefined })).toThrow(/AUTH_SECRET/));
test("rejects a short AUTH_SECRET", () =>
  expect(() => loadApiEnv({ ...valid, AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET/));
test("PUBLIC_ORIGIN must be one of ALLOWED_ORIGINS", () =>
  expect(() => loadApiEnv({ ...valid, PUBLIC_ORIGIN: "https://elsewhere.example" })).toThrow(
    /PUBLIC_ORIGIN/,
  ));
test("login rate limits default to on", () =>
  expect(loadApiEnv({ ...valid, LOGIN_RATE_LIMITS: undefined }).LOGIN_RATE_LIMITS).toBe("on"));
test("refuses LOGIN_RATE_LIMITS=off on an HTTPS origin", () =>
  expect(() =>
    loadApiEnv({
      ...valid,
      ALLOWED_ORIGINS: "https://padvinder.net",
      PUBLIC_ORIGIN: "https://padvinder.net",
      LOGIN_RATE_LIMITS: "off",
    }),
  ).toThrow(/LOGIN_RATE_LIMITS/));
test("refuses LOGIN_RATE_LIMITS=off when any allowed origin is https", () =>
  expect(() =>
    loadApiEnv({
      ...valid,
      ALLOWED_ORIGINS: `${valid.PUBLIC_ORIGIN},https://padvinder.net`,
      LOGIN_RATE_LIMITS: "off",
    }),
  ).toThrow(/LOGIN_RATE_LIMITS/));
test("allows LOGIN_RATE_LIMITS=off on http://localhost", () =>
  expect(loadApiEnv({ ...valid, LOGIN_RATE_LIMITS: "off" }).LOGIN_RATE_LIMITS).toBe("off"));
test("reads optional SMTP credentials", () =>
  expect(loadApiEnv({ ...valid, SMTP_USER: "u", SMTP_PASSWORD: "p" })).toMatchObject({
    SMTP_USER: "u",
    SMTP_PASSWORD: "p",
  }));

test("MAIL_SUBJECT_PREFIX is optional, and an empty one counts as absent", () => {
  expect(loadApiEnv(valid).MAIL_SUBJECT_PREFIX).toBeUndefined();
  expect(loadApiEnv({ ...valid, MAIL_SUBJECT_PREFIX: "" }).MAIL_SUBJECT_PREFIX).toBeUndefined();
  expect(loadApiEnv({ ...valid, MAIL_SUBJECT_PREFIX: "[STAGING]" }).MAIL_SUBJECT_PREFIX).toBe(
    "[STAGING]",
  );
});

test("a prefix with a line break, or over 30 characters, is refused", () => {
  expect(() => loadApiEnv({ ...valid, MAIL_SUBJECT_PREFIX: "[A]\nBcc: x" })).toThrow(
    /MAIL_SUBJECT_PREFIX/,
  );
  expect(() => loadApiEnv({ ...valid, MAIL_SUBJECT_PREFIX: "x".repeat(31) })).toThrow(
    /MAIL_SUBJECT_PREFIX/,
  );
  expect(
    loadApiEnv({ ...valid, MAIL_SUBJECT_PREFIX: "x".repeat(30) }).MAIL_SUBJECT_PREFIX,
  ).toHaveLength(30);
});

test("reads PADVINDER_ENVIRONMENT; an empty one is the default, development", () => {
  expect(loadApiEnv({ ...valid, PADVINDER_ENVIRONMENT: "staging" }).PADVINDER_ENVIRONMENT).toBe(
    "staging",
  );
  expect(loadApiEnv({ ...valid, PADVINDER_ENVIRONMENT: "" }).PADVINDER_ENVIRONMENT).toBe(
    "development",
  );
});

test("rejects an unknown PADVINDER_ENVIRONMENT", () =>
  expect(() => loadApiEnv({ ...valid, PADVINDER_ENVIRONMENT: "prod" })).toThrow(
    /PADVINDER_ENVIRONMENT/,
  ));
