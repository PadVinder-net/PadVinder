import type { FastifyBaseLogger } from "fastify";
import type { Mail, Mailer } from "./mailer";

/** What may be logged about a failed mail: never the address, a name or a code. */
export function describeMailError(error: unknown) {
  if (!(error instanceof Error)) return { type: typeof error };
  const { code, responseCode, command } = error as Error & {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  return { type: error.name, code, responseCode, command };
}

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
      .then(() => mailer.send(mail))
      .catch((error: unknown) => {
        log.error({ mailKind: kind, mailError: describeMailError(error) }, "Sending a mail failed");
      });
  }
}
