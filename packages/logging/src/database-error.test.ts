import { expect, test } from "vitest";
import {
  DATABASE_ERROR_MESSAGE,
  QUERY_ERROR_MESSAGE,
  withoutDatabaseValues,
  withoutQueryText,
} from "./database-error";
import { serializeError } from "./serialize-error";
import { createTestLogger } from "./testing";

const TOKEN = "session-token-SECRET-1234";

/** node-postgres's error, as it arrives: a value quoted in the message, the row in `detail`. */
class DatabaseError extends Error {
  severity = "ERROR";
  code = "22P02";
  detail = `Key (token)=(${TOKEN}) already exists.`;
  routine = "string_to_uuid";
}

/** The shape of Drizzle's `DrizzleQueryError` (the real one is tested in the API). */
class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    override readonly cause?: unknown,
  ) {
    super(`Failed query: ${query}\nparams: ${params.join(",")}`);
    this.name = "DrizzleQueryError";
  }
}

const queryError = () =>
  new DrizzleQueryError(
    'select "id" from "sessions" where "sessions"."token" = $1',
    [TOKEN],
    new DatabaseError(`invalid input syntax for type uuid: "${TOKEN}"`),
  );

test("a query error loses its message, query and parameters, and keeps its name, stack frames and codes", () => {
  const original = queryError();
  const safe = withoutDatabaseValues(original);
  expect(safe).not.toBe(original);
  expect(safe).toBeInstanceOf(Error);
  expect(safe).toMatchObject({ name: "DrizzleQueryError", message: QUERY_ERROR_MESSAGE });
  expect(safe.stack).toContain(`DrizzleQueryError: ${QUERY_ERROR_MESSAGE}`);
  expect(safe.stack).toContain("database-error.test.ts");
  expect(safe.cause).toMatchObject({ message: DATABASE_ERROR_MESSAGE, code: "22P02" });
  expect(safe).not.toHaveProperty("query");
  expect(safe).not.toHaveProperty("params");
  expect(safe.cause).not.toHaveProperty("detail");
  expect(
    JSON.stringify({ ...safe, stack: safe.stack, cause: { ...(safe.cause as Error) } }),
  ).not.toContain(TOKEN);
  expect(String((safe.cause as Error).stack)).not.toContain(TOKEN);
});

test("a database error under another error is copied too; other errors stay as they are", () => {
  const wrapped = new Error("Recording failed", { cause: queryError() });
  const safe = withoutDatabaseValues(wrapped);
  expect(safe).toMatchObject({ message: "Recording failed" });
  expect(safe.cause).toMatchObject({ name: "DrizzleQueryError", message: QUERY_ERROR_MESSAGE });

  const plain = new Error("connection terminated", { cause: new Error("socket hang up") });
  expect(withoutDatabaseValues(plain)).toBe(plain);
  expect(withoutDatabaseValues("text")).toBe("text");
  const cyclic = new Error("a");
  cyclic.cause = cyclic;
  expect(withoutDatabaseValues(cyclic)).toBe(cyclic);
});

test("a stack that does not hold the message is left out", () => {
  const error = queryError();
  error.stack = `Error: something else ${TOKEN}\n    at x (y.ts:1:1)`;
  const safe = withoutDatabaseValues(error);
  expect(safe.stack).toBeUndefined();
});

test("serializeError keeps no value of a query error or its cause", () => {
  const result = serializeError(queryError());
  expect(result).toMatchObject({
    type: "DrizzleQueryError",
    message: QUERY_ERROR_MESSAGE,
    cause: { message: DATABASE_ERROR_MESSAGE, code: "22P02" },
  });
  expect(JSON.stringify(result)).not.toContain(TOKEN);
});

test("no log line holds a value of a query error, as err or as the first argument", () => {
  const logs = createTestLogger("debug");
  logs.logger.error({ err: queryError(), reqId: "r-1" }, "Unexpected error");
  logs.logger.error(queryError(), "Unexpected error");
  logs.logger.child({ reqId: "r-2" }).error({ err: queryError() }, "In a child");
  expect(logs.text()).not.toContain(TOKEN);
  const [first, second, third] = logs.entries();
  expect(first).toMatchObject({ reqId: "r-1", err: { message: QUERY_ERROR_MESSAGE } });
  expect(second).toMatchObject({ err: { message: QUERY_ERROR_MESSAGE } });
  expect(third).toMatchObject({ reqId: "r-2", err: { type: "DrizzleQueryError" } });
});

test("withoutQueryText cuts Drizzle's query text and parameters from a text", () => {
  expect(withoutQueryText(`DrizzleQueryError: Failed query: select $1\nparams: ${TOKEN}`)).toBe(
    `DrizzleQueryError: ${QUERY_ERROR_MESSAGE}`,
  );
  expect(withoutQueryText("Failed to verify authentication")).toBe(
    "Failed to verify authentication",
  );
});
