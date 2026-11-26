import type { FastifyBaseLogger } from "fastify";
import { describeMailError, type Mail, type Mailer } from "@padvinder/mail";
import { withSpan } from "@padvinder/monitoring";

/**
 * Sends the mails without waiting for the result: the request must not wait for the mail server.
 * A failure is only logged, with the kind of the mail ("new-request", "approved", "rejected"),
 * and there is no retry.
 */
export function sendInBackground(mailer: Mailer, log: FastifyBaseLogger, mails: Mail[]): void {
  for (const mail of mails) {
    const kind = mail.kind ?? "unknown";
    // `send` may also throw before it returns a promise.
    Promise.resolve()
      .then(() =>
        withSpan("mail.send", "mail", { "mail.kind": kind }, async () => mailer.send(mail)),
      )
      .catch((error: unknown) => {
        log.error({ mailKind: kind, mailError: describeMailError(error) }, "Sending a mail failed");
      });
  }
}
