import { expect, test } from "vitest";
import { createMemoryMailer, type Mail } from "./mailer.js";
import { paragraphsToHtml } from "./html.js";

const mail: Mail = {
  to: "noor@example.test",
  subject: "Onderwerp",
  text: "Tekst",
  html: "<p>Tekst</p>",
};

test("the memory mailer keeps what was sent", async () => {
  const mailer = createMemoryMailer();
  await mailer.send(mail);
  expect(mailer.sent).toEqual([mail]);
});

test("the memory mailer can fail on demand", async () => {
  const mailer = createMemoryMailer();
  mailer.failWith(new Error("smtp down"));
  await expect(mailer.send(mail)).rejects.toThrow("smtp down");
  expect(mailer.sent).toEqual([]);
  mailer.failWith(null);
  await mailer.send(mail);
  expect(mailer.sent).toEqual([mail]);
});

test("paragraphsToHtml splits on blank lines and escapes", () =>
  expect(paragraphsToHtml("a <b>\n\nc & d")).toBe("<p>a &lt;b&gt;</p>\n<p>c &amp; d</p>"));
