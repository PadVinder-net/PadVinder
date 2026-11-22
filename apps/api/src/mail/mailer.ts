import nodemailer from "nodemailer";
import type { ApiEnv } from "../env.js";

export type Mail = { to: string; subject: string; text: string; html: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createSmtpMailer(
  env: Pick<ApiEnv, "SMTP_HOST" | "SMTP_PORT" | "SMTP_USER" | "SMTP_PASSWORD" | "MAIL_FROM">,
): Mailer & { close(): void } {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    auth:
      env.SMTP_USER !== undefined && env.SMTP_PASSWORD !== undefined
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(mail) {
      await transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
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
