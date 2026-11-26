import { scrub } from "./scrub";

export type SerializedError = {
  type: string;
  message: string;
  stack?: string;
  code?: string;
  constraint?: string;
  table?: string;
  column?: string;
  cause?: SerializedError;
};

const MAX_CAUSE_DEPTH = 5;
const MAX_NON_ERROR_LENGTH = 500;

function describe(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function text(error: Error, key: string): string | undefined {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? scrub(value) : undefined;
}

function serialize(error: unknown, depth: number, seen: Set<unknown>): SerializedError {
  if (!(error instanceof Error)) {
    return {
      type: error === null ? "object" : typeof error,
      message: scrub(describe(error).slice(0, MAX_NON_ERROR_LENGTH)),
    };
  }
  seen.add(error);
  const result: SerializedError = { type: error.name, message: scrub(error.message) };
  if (error.stack) result.stack = scrub(error.stack);
  for (const key of ["code", "constraint", "table", "column"] as const) {
    const value = text(error, key);
    if (value !== undefined) result[key] = value;
  }
  const cause = error.cause;
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH && !seen.has(cause)) {
    result.cause = serialize(cause, depth + 1, seen);
  }
  return result;
}

export function serializeError(error: unknown): SerializedError {
  return serialize(error, 1, new Set());
}
