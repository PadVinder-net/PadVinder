import { isEmailAddress } from "@padvinder/contracts";

export type EmailLines = {
  /** The right addresses as typed and trimmed. Doubles stay; the API counts them once. */
  emails: string[];
  /** The wrong lines, with the number the person sees (empty lines count). */
  errors: { line: number; text: string }[];
};

/** Reads a pasted list with one address per line. */
export function parseEmailLines(text: string): EmailLines {
  const emails: string[] = [];
  const errors: EmailLines["errors"] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const value = raw.trim();
    if (value === "") return;
    if (isEmailAddress(value)) emails.push(value);
    else errors.push({ line: index + 1, text: value });
  });
  return { emails, errors };
}
