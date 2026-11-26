import nodemailer from "nodemailer";
import { z } from "zod";
import { describe, expect, test, vi } from "vitest";
import {
  createMemoryMailer,
  createSmtpMailer,
  smtpSettingsShape,
  smtpTransportOptions,
  type Mail,
} from "./mailer";

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

describe("createSmtpMailer subject prefix", () => {
  const env = {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: 54325,
    MAIL_FROM: "PadVinder <a@example.test>",
  };
  const subject = "123456 is je inlogcode voor PadVinder";

  async function sentSubject(prefix: string | undefined) {
    const sendMail = vi.fn<(message: { subject: string }) => Promise<void>>();
    sendMail.mockResolvedValue(undefined);
    const spy = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail, close() {} } as never);
    try {
      const mailer = createSmtpMailer({ ...env, MAIL_SUBJECT_PREFIX: prefix });
      await mailer.send({ ...mail, subject });
      return sendMail.mock.calls.at(0)![0].subject;
    } finally {
      spy.mockRestore();
    }
  }

  test("with MAIL_SUBJECT_PREFIX the subject starts with it and a space", async () =>
    expect(await sentSubject("[STAGING]")).toBe("[STAGING] 123456 is je inlogcode voor PadVinder"));
  test("without it the subject is unchanged", async () =>
    expect(await sentSubject(undefined)).toBe(subject));
});

describe("smtpSettingsShape", () => {
  const base = {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    MAIL_FROM: "PadVinder <a@example.test>",
  };
  const schema = z.object(smtpSettingsShape);

  test("reads the six settings, the port as a number", () => {
    expect(schema.parse({ ...base, SMTP_USER: "u", SMTP_PASSWORD: "p" })).toMatchObject({
      SMTP_PORT: 587,
      SMTP_USER: "u",
    });
  });
  test("an empty MAIL_SUBJECT_PREFIX counts as absent", () =>
    expect(schema.parse({ ...base, MAIL_SUBJECT_PREFIX: "" }).MAIL_SUBJECT_PREFIX).toBeUndefined());
  test("a prefix is at most 30 characters and holds no line break", () => {
    expect(schema.parse({ ...base, MAIL_SUBJECT_PREFIX: "[STAGING]" }).MAIL_SUBJECT_PREFIX).toBe(
      "[STAGING]",
    );
    expect(schema.safeParse({ ...base, MAIL_SUBJECT_PREFIX: "x".repeat(31) }).success).toBe(false);
    expect(schema.safeParse({ ...base, MAIL_SUBJECT_PREFIX: "a\nBcc: x" }).success).toBe(false);
  });
});
