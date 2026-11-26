/** What may be logged about a failed mail: never the address, a name or a code. */
export function describeMailError(error: unknown) {
  if (!(error instanceof Error)) return { type: typeof error };
  const { code, responseCode, command } = error as Error & {
    code?: unknown;
    responseCode?: unknown;
    command?: unknown;
  };
  return { type: error.name, code, responseCode, command };
}
