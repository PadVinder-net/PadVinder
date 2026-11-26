import { withoutDatabaseValues } from "./database-error";
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
const UNSERIALIZABLE: SerializedError = { type: "unknown", message: "[unserializable]" };

function constructorName(value: object): string | undefined {
  const name: unknown = (value as { constructor?: { name?: unknown } }).constructor?.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

/**
 * A thrown value that is not an Error. A primitive is kept as scrubbed text; an object is
 * described by its keys only, because its values may be a name or a phone number.
 */
function serializeNonError(value: unknown): SerializedError {
  if (typeof value !== "object" || value === null) {
    return {
      type: value === null ? "object" : typeof value,
      message: scrub(String(value).slice(0, MAX_NON_ERROR_LENGTH)),
    };
  }
  return {
    type: constructorName(value) ?? "object",
    message: scrub(
      `object with keys: ${Object.keys(value).join(", ")}`.slice(0, MAX_NON_ERROR_LENGTH),
    ),
  };
}

function text(error: Error, key: string): string | undefined {
  const value = (error as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? scrub(value) : undefined;
}

function serialize(error: unknown, depth: number, seen: Set<unknown>): SerializedError {
  try {
    if (!(error instanceof Error)) return serializeNonError(error);
    seen.add(error);
    const message: unknown = error.message;
    const result: SerializedError = {
      type: text(error, "name") ?? constructorName(error) ?? "Error",
      message: scrub(typeof message === "string" ? message : String(message)),
    };
    const stack = text(error, "stack");
    if (stack) result.stack = stack;
    for (const key of ["code", "constraint", "table", "column"] as const) {
      const value = text(error, key);
      if (value !== undefined) result[key] = value;
    }
    const cause = error.cause;
    if (cause !== undefined && depth < MAX_CAUSE_DEPTH && !seen.has(cause)) {
      result.cause = serialize(cause, depth + 1, seen);
    }
    return result;
  } catch {
    return { ...UNSERIALIZABLE };
  }
}

/**
 * Never throws: a value that cannot be read becomes `{ type: "unknown", message: "[unserializable]" }`.
 * A database error (and a database error as a cause) loses its message (`withoutDatabaseValues`).
 */
export function serializeError(error: unknown): SerializedError {
  return serialize(withoutDatabaseValues(error), 1, new Set());
}
