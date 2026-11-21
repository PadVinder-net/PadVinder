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
