// Anything that looks like an email address, to keep addresses out of log lines (and, later, out
// of Sentry events). It runs on finished JSON lines, so a JSON escape sequence (`\n`, `\"`,
// `\u0001`) is matched first as a whole and kept: an address right after one must not swallow the
// escape's letter. In plain (non-JSON) text, an address with a one-character local part right
// after a literal backslash is therefore not scrubbed.
//
// Every part is bounded (local part at most 64 characters, labels at most 63, at most 8 labels
// before the last), so each start position costs a constant amount: a long run without a
// separator scrubs in linear time. The domain never holds `/ ? & =`, and its last label starts
// with a letter, so pnpm paths in stack frames (`.pnpm/pg-pool@3.14.0_pg@8.23.1/node_modules/…`)
// stay as they are.
const LOCAL = String.raw`[^\s\\@<>"'(),;:/?&=]{1,64}`;
const LABEL = String.raw`[^\s\\@<>"'(),;:/?&=.]`;
const ESCAPE_OR_ADDRESS = new RegExp(
  String.raw`(\\u[0-9a-fA-F]{4}|\\[\s\S])|${LOCAL}@(?:${LABEL}{1,63}\.){1,8}[A-Za-z]${LABEL}{0,62}`,
  "g",
);

export function scrub(text: string): string {
  return text.replace(ESCAPE_OR_ADDRESS, (match, escape: string | undefined) =>
    escape === undefined ? "[email]" : match,
  );
}
