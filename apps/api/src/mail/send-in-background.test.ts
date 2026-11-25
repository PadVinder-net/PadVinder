import { expect, test, vi } from "vitest";
import { createMemoryMailer } from "@padvinder/mail";
import { sendInBackground } from "./send-in-background";

const mail = { to: "geheim@example.test", subject: "Onderwerp", text: "t", html: "h" };

test("a failure is logged with the kind only", async () => {
  const mailer = createMemoryMailer();
  mailer.failWith(new Error("550 geheim@example.test rejected"));
  const error = vi.fn();
  sendInBackground(mailer, { error } as never, [{ ...mail, kind: "approved" }]);
  await vi.waitFor(() => expect(error).toHaveBeenCalled());
  const logged = JSON.stringify(error.mock.calls);
  expect(logged).toContain("approved");
  expect(logged).not.toContain("geheim");
});

test("it sends every mail and returns before they are sent", async () => {
  const mailer = createMemoryMailer();
  const result = sendInBackground(mailer, { error: vi.fn() } as never, [mail, mail]);
  expect(result).toBeUndefined();
  await vi.waitFor(() => expect(mailer.sent).toHaveLength(2));
});
