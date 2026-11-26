/**
 * Database errors whose text holds values. Drizzle's `DrizzleQueryError` puts the query and its
 * parameters in its message (`Failed query: …\nparams: …`): a session token, a credential ID, a
 * name or a phone number. PostgreSQL's own message can quote a value (`invalid input syntax for
 * type uuid: "…"`). Such an error keeps its name, SQLSTATE `code`, `constraint`, `table` and
 * `column`, never its message; its stack keeps the frames.
 */

export const QUERY_ERROR_MESSAGE = "Failed query (query and parameters left out)";
export const DATABASE_ERROR_MESSAGE = "Database error (message left out)";

const MAX_CAUSE_DEPTH = 5;
const KEPT_KEYS = ["code", "constraint", "table", "column"] as const;

function read(error: Error, key: string): unknown {
  return (error as unknown as Record<string, unknown>)[key];
}

function constructorName(error: Error): unknown {
  return (error as { constructor?: { name?: unknown } }).constructor?.name;
}

/** Drizzle's error of a failed query, by its name or by its shape (`query` and `params`). */
function isQueryError(error: Error): boolean {
  return (
    error.name === "DrizzleQueryError" ||
    constructorName(error) === "DrizzleQueryError" ||
    ("query" in error && "params" in error)
  );
}

/** node-postgres's `DatabaseError`: an error PostgreSQL sent, with a `severity`. */
function isPostgresError(error: Error): boolean {
  return constructorName(error) === "DatabaseError" || typeof read(error, "severity") === "string";
}

/** The fixed message that replaces the error's own, or undefined when its message may stay. */
function replacementMessage(error: Error): string | undefined {
  if (isQueryError(error)) return QUERY_ERROR_MESSAGE;
  if (isPostgresError(error)) return DATABASE_ERROR_MESSAGE;
  return undefined;
}

function needsRedaction(value: unknown, depth: number, seen: Set<unknown>): boolean {
  if (!(value instanceof Error) || seen.has(value) || depth > MAX_CAUSE_DEPTH) return false;
  seen.add(value);
  return replacementMessage(value) !== undefined || needsRedaction(value.cause, depth + 1, seen);
}

/** The stack with the message replaced; without a stack when the message is not found in it. */
function stackWith(error: Error, message: string): string | undefined {
  const stack = read(error, "stack");
  if (typeof stack !== "string") return undefined;
  const original = String(error.message);
  if (original.length === 0) return stack;
  return stack.includes(original) ? stack.replace(original, () => message) : undefined;
}

function redact(error: Error, depth: number, seen: Set<unknown>): Error {
  seen.add(error);
  const message = replacementMessage(error);
  const copy = new Error(message ?? String(error.message));
  copy.name = typeof error.name === "string" ? error.name : "Error";
  const stack = message === undefined ? read(error, "stack") : stackWith(error, message);
  if (typeof stack === "string") copy.stack = stack;
  else delete copy.stack;
  for (const key of KEPT_KEYS) {
    const value = read(error, key);
    if (typeof value === "string") (copy as unknown as Record<string, unknown>)[key] = value;
  }
  const cause = error.cause;
  if (cause instanceof Error && depth < MAX_CAUSE_DEPTH && !seen.has(cause)) {
    copy.cause = redact(cause, depth + 1, seen);
  } else if (cause !== undefined && !(cause instanceof Error)) {
    copy.cause = cause;
  }
  return copy;
}

/**
 * The value itself when neither it nor a cause is a database error; otherwise a plain `Error`
 * copy of it (same name, kept fields, causes copied the same way) whose database errors have a
 * fixed message (`QUERY_ERROR_MESSAGE`, `DATABASE_ERROR_MESSAGE`). Never throws.
 */
export function withoutDatabaseValues<T>(value: T): T | Error {
  try {
    if (!(value instanceof Error) || !needsRedaction(value, 1, new Set())) return value;
    return redact(value, 1, new Set());
  } catch {
    return new Error(DATABASE_ERROR_MESSAGE);
  }
}

/** A text with everything from Drizzle's `Failed query:` on replaced by `QUERY_ERROR_MESSAGE`. */
export function withoutQueryText(text: string): string {
  const start = text.indexOf("Failed query:");
  return start === -1 ? text : `${text.slice(0, start)}${QUERY_ERROR_MESSAGE}`;
}
