import { randomInt } from "node:crypto";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const letters = "abcdefghijklmnopqrstuvwxyz";

/** `length` random characters from `characters`. */
export function randomCharacters(length: number, characters = alphabet): string {
  return Array.from({ length }, () => characters[randomInt(characters.length)]).join("");
}

/**
 * A made-up address no other test uses: `e2e-<label>-<8 random characters>@example.test`.
 * All workspaces share one Mailpit inbox, so every test needs its own addresses.
 */
export function newAddress(label: string): string {
  return `e2e-${label}-${randomCharacters(8)}@example.test`;
}

/** Eight random letters, for names that no other test or workspace uses. */
export function randomWord(): string {
  return randomCharacters(8, letters);
}

type MailpitSummary = {
  ID: string;
  To: { Address: string }[] | null;
  Subject: string;
  Created: string;
};

type MailpitMessage = { Subject: string; Text: string };

function mailpitUrl(): string {
  const url = process.env.MAILPIT_URL;
  if (!url) throw new Error("MAILPIT_URL is not set. Run scripts/setup-workspace.sh.");
  return url;
}

async function getJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`Mailpit answered ${response.status} on ${url.pathname}`);
  return (await response.json()) as T;
}

/** The mails to exactly `address` whose subject contains `subjectIncludes`, newest first. */
async function mailsTo(address: string, subjectIncludes: string): Promise<MailpitSummary[]> {
  const url = new URL("/api/v1/search", mailpitUrl());
  url.searchParams.set("query", `to:"${address}"`);
  url.searchParams.set("limit", "50");
  const { messages } = await getJson<{ messages: MailpitSummary[] }>(url);
  // The search matches parts of addresses too, so keep only exact matches.
  return messages
    .filter(
      (message) =>
        (message.To ?? []).some((to) => to.Address.toLowerCase() === address.toLowerCase()) &&
        message.Subject.includes(subjectIncludes),
    )
    .toSorted((a, b) => Date.parse(b.Created) - Date.parse(a.Created));
}

/**
 * The newest mail to `address` whose subject contains `subjectIncludes`, once there are at least
 * `count` such mails (default 1). Waits at most 10 seconds. Use `count` when an earlier mail of
 * the same kind exists, such as a second login code to the same address.
 */
export async function readMail(
  address: string,
  subjectIncludes: string,
  { count = 1 }: { count?: number } = {},
): Promise<{ subject: string; text: string }> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const mails = await mailsTo(address, subjectIncludes);
    if (mails.length >= count) {
      const message = await getJson<MailpitMessage>(
        new URL(`/api/v1/message/${mails[0]!.ID}`, mailpitUrl()),
      );
      return { subject: message.Subject, text: message.Text };
    }
    if (Date.now() > deadline) {
      throw new Error(`No mail "${subjectIncludes}" to ${address} within 10 seconds`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The login code from the newest login mail to `address`: the first six characters of its
 * subject. Waits at most 10 seconds; `count` as in `readMail`.
 */
export async function readLoginCode(
  address: string,
  options?: { count?: number },
): Promise<string> {
  const { subject } = await readMail(address, "is je inlogcode voor PadVinder", options);
  const code = subject.slice(0, 6);
  if (!/^\d{6}$/.test(code)) throw new Error(`No code in the subject "${subject}"`);
  return code;
}
