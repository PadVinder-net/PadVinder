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
test("a thrown non-Error is serialized and scrubbed", () => {
  expect(serializeError("boom a@b.test")).toEqual({ type: "string", message: "boom [email]" });
  expect(serializeError({ email: "a@b.test" }).message).not.toContain("a@b.test");
});
