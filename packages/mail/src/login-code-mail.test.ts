import { describe, expect, test } from "vitest";
import { buildLoginCodeMail } from "./login-code-mail";

describe("the login code mail", () => {
  const mail = buildLoginCodeMail({
    to: "noor@example.test",
    code: "012345",
    recipientName: "Noor",
  });

  test("is addressed to the recipient", () => expect(mail.to).toBe("noor@example.test"));
  test("the subject starts with the code", () =>
    expect(mail.subject).toBe("012345 is je inlogcode voor PadVinder"));
  test("the text starts with the greeting and an empty line", () =>
    expect(mail.text.split("\n").slice(0, 2)).toEqual(["Hallo Noor,", ""]));
  test("the code is on its own line next to the word code", () =>
    expect(mail.text.split("\n")[2]).toBe("Je code: 012345"));
  test.each([
    ["text", mail.text],
    ["html", mail.html],
    ["subject", mail.subject],
  ])("the %s holds no digit besides the code", (_part, value) =>
    expect(value.replaceAll("012345", "").match(/\d/)).toBeNull(),
  );
  test("the html part holds the code once", () =>
    expect(mail.html.split("012345")).toHaveLength(2));
  test("the text is the exact copy", () =>
    expect(mail.text).toBe(
      "Hallo Noor,\n\nJe code: 012345\n\nVul deze code in bij PadVinder om in te loggen. De code is een half uur geldig.\n\nHeb je geen code aangevraagd? Dan hoef je niets te doen.",
    ));
});

test("a name with digits gives a greeting without a name, so the mail holds only the code's digits", () => {
  const mail = buildLoginCodeMail({
    to: "a@example.test",
    code: "123456",
    recipientName: "Agent 007",
  });
  expect(mail.text.match(/\d/g)).toHaveLength(6);
  expect(mail.html.match(/\d/g)).toHaveLength(6);
  expect(mail.text.startsWith("Hallo,\n\n")).toBe(true);
});
