import { describe, expect, test } from "vitest";
import { createMemoryMailer, smtpTransportOptions, type Mail } from "./mailer";

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

describe("smtpTransportOptions", () => {
  const base = { SMTP_HOST: "smtp.example.test", MAIL_FROM: "PadVinder <a@example.test>" };
  const credentials = { SMTP_USER: "user", SMTP_PASSWORD: "secret" };

  test("without credentials TLS is not forced (Mailpit)", () => {
    const options = smtpTransportOptions({ ...base, SMTP_PORT: 54325 });
    expect(options).toMatchObject({ secure: false, requireTLS: false, auth: undefined });
  });
  test("with credentials on 587 STARTTLS is required", () => {
    const options = smtpTransportOptions({ ...base, ...credentials, SMTP_PORT: 587 });
    expect(options).toMatchObject({ secure: false, requireTLS: true });
    expect(options.auth).toEqual({ user: "user", pass: "secret" });
  });
  test("with credentials on 465 the connection is secure from the start", () => {
    const options = smtpTransportOptions({ ...base, ...credentials, SMTP_PORT: 465 });
    expect(options).toMatchObject({ secure: true, requireTLS: false });
  });
});
