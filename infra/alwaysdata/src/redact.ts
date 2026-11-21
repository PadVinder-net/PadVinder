/** Hides secrets in text that may end up in a log or an error message. */
export function redact(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    result = result.split(secret).join("***");
    result = result.split(encodeURIComponent(secret)).join("***");
  }
  return result.replace(/(postgres(?:ql)?:\/\/[^:/@\s]*:)[^@\s]*@/g, "$1***@");
}

const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const ipv4 = `${octet}(?:\\.${octet}){3}`;
const hex = "[0-9A-Fa-f]{1,4}";
// Eight groups, or fewer around one `::`, optionally ending in an IPv4 address, optionally
// with a zone (`%eth0`). Not inside a longer word, so times such as 20:00:30 stay.
const ipv6Pattern = new RegExp(
  `(?<![\\w.:])(?:(?:${hex}:){7}${hex}|(?:(?:${hex}:)*${hex})?::(?:(?:${hex}:)*(?:${ipv4}|${hex}))?)(?:%[\\w.-]+)?(?![\\w.:]*\\w)`,
  "g",
);
// Not part of a longer dotted number, such as a version 1.2.3.4.5.
const ipv4Pattern = new RegExp(`(?<![\\w.])${ipv4}(?![\\w.]*\\w)`, "g");

/** Replaces IPv4 and IPv6 addresses with `<ip>`. */
export function redactIpAddresses(text: string): string {
  return text.replace(ipv6Pattern, "<ip>").replace(ipv4Pattern, "<ip>");
}

/**
 * The filter for every line the CLIs print, which may land in a public log: secrets become
 * `***`, IP addresses `<ip>` and the account name `<account>`.
 */
export function redactForLog(text: string, secrets: readonly string[], account: string): string {
  const redacted = redactIpAddresses(redact(text, secrets));
  return account === "" ? redacted : redacted.replaceAll(account, "<account>");
}
