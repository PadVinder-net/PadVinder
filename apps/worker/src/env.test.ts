import { expect, test } from "vitest";
import { loadWorkerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgres://x",
  PUBLIC_ORIGIN: "http://localhost:4101",
  SMTP_HOST: "localhost",
  SMTP_PORT: "54325",
  MAIL_FROM: "PadVinder <noreply@padvinder.test>",
};

test("names the missing variable", () => expect(() => loadWorkerEnv({})).toThrow(/DATABASE_URL/));

test("parses a valid environment and defaults LOG_LEVEL to info", () =>
  expect(loadWorkerEnv(valid)).toEqual({
    DATABASE_URL: "postgres://x",
    GIT_COMMIT: "dev",
    LOG_LEVEL: "info",
    PADVINDER_ENVIRONMENT: "development",
    PUBLIC_ORIGIN: "http://localhost:4101",
    SMTP_HOST: "localhost",
    SMTP_PORT: 54325,
    MAIL_FROM: "PadVinder <noreply@padvinder.test>",
  }));

test("rejects an unknown LOG_LEVEL", () =>
  expect(() => loadWorkerEnv({ ...valid, LOG_LEVEL: "loud" })).toThrow(/LOG_LEVEL/));

test("names every problem at once, each with its variable", () =>
  expect(() => loadWorkerEnv({ ...valid, DATABASE_URL: undefined, LOG_LEVEL: "loud" })).toThrow(
    /^Invalid worker environment: DATABASE_URL: .+; LOG_LEVEL: .+/,
  ));

test("the worker names every missing mail setting", () => {
  const { DATABASE_URL } = valid;
  let message = "";
  try {
    loadWorkerEnv({ DATABASE_URL });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toMatch(/^Invalid worker environment: /);
  for (const name of ["PUBLIC_ORIGIN", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM"]) {
    expect(message).toContain(`${name}: `);
  }
  expect(message).not.toContain("DATABASE_URL");
  // The optional ones are not missing.
  for (const name of ["SMTP_USER", "SMTP_PASSWORD", "MAIL_SUBJECT_PREFIX"]) {
    expect(message).not.toContain(name);
  }
});

test("PUBLIC_ORIGIN must be an origin, without a path or trailing slash", () => {
  expect(() => loadWorkerEnv({ ...valid, PUBLIC_ORIGIN: "http://localhost:4101/" })).toThrow(
    /PUBLIC_ORIGIN/,
  );
  expect(() => loadWorkerEnv({ ...valid, PUBLIC_ORIGIN: "localhost" })).toThrow(/PUBLIC_ORIGIN/);
});

test("reads the optional SMTP credentials and the subject prefix", () =>
  expect(
    loadWorkerEnv({
      ...valid,
      SMTP_USER: "user",
      SMTP_PASSWORD: "secret",
      MAIL_SUBJECT_PREFIX: "[STAGING]",
    }),
  ).toMatchObject({
    SMTP_USER: "user",
    SMTP_PASSWORD: "secret",
    MAIL_SUBJECT_PREFIX: "[STAGING]",
  }));

test("an empty value counts as not set", () => {
  expect(() => loadWorkerEnv({ ...valid, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  expect(loadWorkerEnv({ ...valid, LOG_LEVEL: "" }).LOG_LEVEL).toBe("info");
  expect(loadWorkerEnv({ ...valid, MAIL_SUBJECT_PREFIX: "" }).MAIL_SUBJECT_PREFIX).toBeUndefined();
});

test("reads PADVINDER_ENVIRONMENT; an empty one is the default, development", () => {
  expect(loadWorkerEnv({ ...valid, PADVINDER_ENVIRONMENT: "staging" }).PADVINDER_ENVIRONMENT).toBe(
    "staging",
  );
  expect(loadWorkerEnv({ ...valid, PADVINDER_ENVIRONMENT: "" }).PADVINDER_ENVIRONMENT).toBe(
    "development",
  );
});

test("rejects an unknown PADVINDER_ENVIRONMENT", () =>
  expect(() => loadWorkerEnv({ ...valid, PADVINDER_ENVIRONMENT: "prod" })).toThrow(
    /PADVINDER_ENVIRONMENT/,
  ));
