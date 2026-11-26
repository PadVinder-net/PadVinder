import { expect, test } from "vitest";
import { readMonitoringSettings } from "./settings";

test("defaults: off, development, dev", () => {
  expect(readMonitoringSettings({})).toEqual({
    dsn: undefined,
    environment: "development",
    release: "dev",
  });
  expect(readMonitoringSettings({ SENTRY_DSN: "" }).dsn).toBeUndefined();
  expect(readMonitoringSettings({ GIT_COMMIT: "" }).release).toBe("dev");
});

test("reads the DSN, environment and commit", () => {
  expect(
    readMonitoringSettings({
      SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
      PADVINDER_ENVIRONMENT: "staging",
      GIT_COMMIT: "abc",
    }),
  ).toEqual({ dsn: "https://k@o1.ingest.de.sentry.io/2", environment: "staging", release: "abc" });
  expect(readMonitoringSettings({ SENTRY_DSN: "http://public@127.0.0.1:9/1" }).dsn).toBe(
    "http://public@127.0.0.1:9/1",
  );
});

test("errors name the variable, never the value", () => {
  expect(() => readMonitoringSettings({ SENTRY_DSN: "not a url secret-value" })).toThrow(
    /SENTRY_DSN/,
  );
  expect(() => readMonitoringSettings({ SENTRY_DSN: "not a url secret-value" })).not.toThrow(
    /secret-value/,
  );
  expect(() => readMonitoringSettings({ SENTRY_DSN: "ftp://secret-value@host/1" })).toThrow(
    /^Invalid monitoring settings: SENTRY_DSN: /,
  );
  expect(() => readMonitoringSettings({ SENTRY_DSN: "ftp://secret-value@host/1" })).not.toThrow(
    /secret-value/,
  );
  expect(() => readMonitoringSettings({ PADVINDER_ENVIRONMENT: "prod" })).toThrow(
    /PADVINDER_ENVIRONMENT/,
  );
});
