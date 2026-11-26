// A line break in a name would start a new line in the text part and a new header line in the
// subject. Besides \r and \n: vertical tab, form feed, NEL and the Unicode line and paragraph
// separators.
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]+/g;

/** The name on one line, trimmed. */
export function singleLine(name: string): string {
  return name.replace(LINE_BREAKS, " ").trim();
}

/**
 * The first line of every mail: `Hallo {naam},`, or `Hallo,` without a usable name. The login code
 * mail passes `withoutDigits`, so the mail holds no digit besides the code.
 */
export function greeting(name: string, options: { withoutDigits?: boolean } = {}): string {
  const clean = singleLine(name);
  if (clean === "" || (options.withoutDigits && /\d/.test(clean))) return "Hallo,";
  return `Hallo ${clean},`;
}
