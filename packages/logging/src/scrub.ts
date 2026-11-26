// Anything that looks like an email address, to keep addresses out of log lines.
const EMAIL_LIKE = /[^\s\\@<>"'(),;:/?&=]+@[^\s\\@<>"'(),;:]+/g;

export function scrub(text: string): string {
  return text.replace(EMAIL_LIKE, "[email]");
}
