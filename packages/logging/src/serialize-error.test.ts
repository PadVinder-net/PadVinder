import { expect, test } from "vitest";
import { serializeError } from "./serialize-error";

test("keeps only the allowlisted fields of a PostgreSQL error", () => {
  const error = Object.assign(
    new Error('duplicate key value violates unique constraint "users_email_key"'),
    {
      code: "23505",
      constraint: "users_email_key",
      table: "users",
      detail: "Key (lower(email))=(noor@example.test) already exists.",
      where: "x",
      parameters: ["noor@example.test"],
    },
  );
  const result = serializeError(error);
  expect(result).toMatchObject({
    type: "Error",
    code: "23505",
    constraint: "users_email_key",
    table: "users",
  });
  expect(JSON.stringify(result)).not.toContain("noor@example.test");
  expect(result).not.toHaveProperty("detail");
  expect(result).not.toHaveProperty("parameters");
});
test("scrubs message and stack, follows cause, stops on a cycle", () => {
  const inner = new Error("smtp refused a@b.test");
  const outer = new Error("send failed", { cause: inner });
  (inner as Error & { cause?: unknown }).cause = outer;
  const result = serializeError(outer);
  expect(result.cause?.message).toBe("smtp refused [email]");
  expect(JSON.stringify(result)).not.toContain("a@b.test");
});
test("a thrown primitive is kept as scrubbed text", () => {
  expect(serializeError("boom a@b.test")).toEqual({ type: "string", message: "boom [email]" });
  expect(serializeError(42)).toEqual({ type: "number", message: "42" });
  expect(serializeError(null)).toEqual({ type: "object", message: "null" });
  expect(serializeError(`${"x".repeat(600)}`).message).toHaveLength(500);
});
test("a thrown non-Error object is logged by its keys only", () => {
  const result = serializeError({ name: "Anne de Vries", phone: "0612345678", email: "a@b.test" });
  expect(result).toEqual({ type: "Object", message: "object with keys: name, phone, email" });
  const text = JSON.stringify(result);
  expect(text).not.toContain("Anne");
  expect(text).not.toContain("0612345678");
  expect(text).not.toContain("a@b.test");
  class Payload {
    secret = "s";
  }
  expect(serializeError(new Payload())).toEqual({
    type: "Payload",
    message: "object with keys: secret",
  });
  expect(serializeError(Object.create(null))).toEqual({
    type: "object",
    message: "object with keys: ",
  });
});
test("an error whose message or stack is not a string is still serialized", () => {
  const error = new Error("x");
  Object.defineProperty(error, "message", { value: 42 });
  Object.defineProperty(error, "stack", { value: { frames: [] } });
  Object.defineProperty(error, "name", { value: undefined });
  let result: unknown;
  expect(() => (result = serializeError(error))).not.toThrow();
  expect(result).toMatchObject({ type: "Error", message: "42" });
  expect(result).not.toHaveProperty("stack");
});
test("an error that throws when read gives a fixed fallback", () => {
  const error = new Error("x");
  Object.defineProperty(error, "message", {
    get() {
      throw new Error("no");
    },
  });
  expect(serializeError(error)).toEqual({ type: "unknown", message: "[unserializable]" });
  const outer = new Error("outer", { cause: error });
  expect(serializeError(outer).cause).toEqual({ type: "unknown", message: "[unserializable]" });
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("no");
      },
    },
  );
  expect(serializeError(hostile)).toEqual({ type: "unknown", message: "[unserializable]" });
});
