import { randomInt } from "node:crypto";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A made-up address no other test uses: `e2e-<label>-<8 random characters>@example.test`.
 * All workspaces share one Mailpit inbox, so every test needs its own addresses.
 */
export function newAddress(label: string): string {
  const suffix = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `e2e-${label}-${suffix}@example.test`;
}

type MailpitMessage = {
  To: { Address: string }[] | null;
  Subject: string;
  Created: string;
};

function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL;
  if (!url) throw new Error("MAILPIT_URL is not set. Run scripts/setup-workspace.sh.");
  return url;
}

async function newestMailTo(address: string): Promise<MailpitMessage | undefined> {
  const url = new URL("/api/v1/search", mailpitUrl());
  url.searchParams.set("query", `to:"${address}"`);
  url.searchParams.set("limit", "50");
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} on ${url.pathname}`);
  const { messages } = (await response.json()) as { messages: MailpitMessage[] };
  // The search matches parts of addresses too, so keep only exact matches.
  return messages
    .filter((message) =>
      (message.To ?? []).some((to) => to.Address.toLowerCase() === address.toLowerCase()),
    )
    .toSorted((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
}

/**
 * The login code from the newest mail to `address`: the first six characters of its subject.
 * Waits at most 10 seconds for the mail to arrive.
 */
export async function readLoginCode(address: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mail = await newestMailTo(address);
    if (mail) {
      const code = mail.Subject.slice(0, 6);
      if (!/^\d{6}$/.test(code)) throw new Error(`No code in the subject "${mail.Subject}"`);
      return code;
    }
    if (Date.now() > deadline) throw new Error(`No mail to ${address} within 10 seconds`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
