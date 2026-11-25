/** The text with its first letter in upper case and the rest unchanged. */
export function capitalizeFirst(text: string): string {
  const first = text.codePointAt(0);
  if (first === undefined) return text;
  const firstChar = String.fromCodePoint(first);
  return firstChar.toUpperCase() + text.slice(firstChar.length);
}
