// Anything that looks like an email address, to keep addresses out of log lines. It runs on
// finished JSON lines, so a JSON escape sequence (`\n`, `\"`, `\u0001`) is matched first as a
// whole and kept: an address right after one must not swallow the escape's letter.
const ESCAPE_OR_ADDRESS = /(\\u[0-9a-fA-F]{4}|\\[\s\S])|[^\s\\@<>"'(),;:/?&=]+@[^\s\\@<>"'(),;:]+/g;

export function scrub(text: string): string {
  return text.replace(ESCAPE_OR_ADDRESS, (match, escape: string | undefined) =>
    escape === undefined ? "[email]" : match,
  );
}
