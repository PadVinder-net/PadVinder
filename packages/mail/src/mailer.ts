import nodemailer from "nodemailer";
import { z } from "zod";

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** What the mail is about ("approved"), for the log of a failure; never an address or a name. */
  kind?: string;
};

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export type SmtpSettings = {
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  MAIL_FROM: string;
  /** Put before the subject of every mail ("[STAGING]"). */
  MAIL_SUBJECT_PREFIX?: string | undefined;
};

/** The Zod fields of `SmtpSettings`, for the env schema of the API and of the worker. */
export const smtpSettingsShape = {
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1),
  // Put before the subject of every mail ("[STAGING]"); empty counts as absent. No line break:
  // the text goes into a mail header.
  MAIL_SUBJECT_PREFIX: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .max(30, "at most 30 characters")
      .regex(/^[^\r\n]*$/, "must not contain a line break")
      .optional(),
  ),
};

// With credentials, TLS is required so they never travel in plaintext.
export function smtpTransportOptions(env: SmtpSettings) {
  const hasCredentials = env.SMTP_USER !== undefined && env.SMTP_PASSWORD !== undefined;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: hasCredentials && env.SMTP_PORT === 465,
    requireTLS: hasCredentials && env.SMTP_PORT !== 465,
    auth: hasCredentials ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  };
}

export function createSmtpMailer(env: SmtpSettings): Mailer & { close(): void } {
  const transport = nodemailer.createTransport(smtpTransportOptions(env));
  return {
    async send(mail) {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject:
          env.MAIL_SUBJECT_PREFIX === undefined
            ? mail.subject
            : `${env.MAIL_SUBJECT_PREFIX} ${mail.subject}`,
        text: mail.text,
        html: mail.html,
      });
    },
    close() {
      transport.close();
    },
  };
}

export function createMemoryMailer(): Mailer & {
  sent: Mail[];
  failWith(error: Error | null): void;
} {
  const sent: Mail[] = [];
  let failure: Error | null = null;
  return {
    sent,
    failWith(error) {
      failure = error;
    },
    async send(mail) {
      if (failure) throw failure;
      sent.push(mail);
    },
  };
}
