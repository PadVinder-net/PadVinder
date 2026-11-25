import nodemailer from "nodemailer";
import type { ApiEnv } from "../env";

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

type SmtpEnv = Pick<
  ApiEnv,
  "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD" | "MAIL_FROM"
> &
  Partial<Pick<ApiEnv, "MAIL_SUBJECT_PREFIX">>;

// With credentials, TLS is required so they never travel in plaintext.
export function smtpTransportOptions(env: SmtpEnv) {
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

export function createSmtpMailer(env: SmtpEnv): Mailer & { close(): void } {
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
