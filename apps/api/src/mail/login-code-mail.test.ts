import { describe, expect, test } from "vitest";
import { buildLoginCodeMail } from "./login-code-mail";

describe("the login code mail", () => {
  const mail = buildLoginCodeMail({ to: "noor@example.test", code: "012345" });

  test("is addressed to the recipient", () => expect(mail.to).toBe("noor@example.test"));
  test("the subject starts with the code", () =>
    expect(mail.subject).toBe("012345 is je inlogcode voor PadVinder"));
  test("the code is on its own line next to the word code", () =>
    expect(mail.text.split("\n")[0]).toBe("Je code: 012345"));
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
      "Je code: 012345\n\nVul deze code in bij PadVinder om in te loggen. De code is een half uur geldig.\n\nHeb je geen code aangevraagd? Dan hoef je niets te doen.",
    ));
});
