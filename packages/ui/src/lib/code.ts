const codeLength = 6;

/** Keeps the digits of a typed or pasted login code, at most six. A string, so a leading zero stays. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, codeLength);
}

export function isCompleteCode(code: string): boolean {
  return code.length === codeLength;
}
