import { expect, test } from "vitest";
import { describeMailError } from "./mail-error";

test("describes only type and SMTP codes, never the message", () => {
  const error = Object.assign(new Error("550 noor@example.test rejected"), {
    code: "EENVELOPE",
    responseCode: 550,
    command: "RCPT TO",
  });
  expect(describeMailError(error)).toEqual({
    type: "Error",
    code: "EENVELOPE",
    responseCode: 550,
    command: "RCPT TO",
  });
  expect(describeMailError("x")).toEqual({ type: "string" });
});
