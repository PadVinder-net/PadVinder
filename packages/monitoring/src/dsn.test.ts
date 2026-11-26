import { expect, test } from "vitest";
import { parseDsn } from "./dsn";

test("reads the public key, host and project ID, and makes the ingest URL", () => {
  expect(parseDsn("https://0123456789abcdef@o123456.ingest.de.sentry.io/7654321")).toEqual({
    publicKey: "0123456789abcdef",
    host: "o123456.ingest.de.sentry.io",
    projectId: "7654321",
    ingestUrl: "https://o123456.ingest.de.sentry.io/api/7654321/envelope/",
  });
});

test("keeps a port and a path before the project ID in the ingest URL", () => {
  expect(parseDsn("http://public@127.0.0.1:9/1")).toEqual({
    publicKey: "public",
    host: "127.0.0.1",
    projectId: "1",
    ingestUrl: "http://127.0.0.1:9/api/1/envelope/",
  });
  expect(parseDsn("https://key@sentry.example.org/sub/42").ingestUrl).toBe(
    "https://sentry.example.org/sub/api/42/envelope/",
  );
});

test.each([
  ["not a url secret-value", /not a URL/],
  ["https://secret-value@host.test/1", /public key/],
  ["ftp://secretvalue@host.test/1", /https or http/],
  ["https://secret-value.example.com", /public key/],
  ["https://secret-value.example.com/1", /public key/],
  ["https://:secretvalue@host.test/1", /public key/],
  ["https://secretvalue@host.test", /project ID/],
  ["https://secretvalue@host.test/", /project ID/],
  ["https://secretvalue@host.test/project", /project ID/],
  ["https://secretvalue@host.test/1/", /project ID/],
  ["https://secretvalue@host.test/1?x=1", /query or fragment/],
  ["https://secretvalue@host.test/1#x", /query or fragment/],
])("refuses %s without naming the value", (value, problem) => {
  expect(() => parseDsn(value)).toThrow(problem);
  expect(() => parseDsn(value)).not.toThrow(/secret-?value/);
});
