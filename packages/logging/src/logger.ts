import pino from "pino";
import { withoutDatabaseValues } from "./database-error";
import { scrub } from "./scrub";
import { serializeError } from "./serialize-error";

export type Logger = pino.Logger;
export type LogLevel = "debug" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export type LoggerOptions = {
  service: "api" | "worker";
  level: LogLevel;
  destination?: { write(line: string): void };
};

type RequestLike = { method?: unknown; url?: unknown; host?: unknown; hostname?: unknown };

/** Leaves out the address, port and headers of a request, and the query and fragment of its URL. */
function serializeRequest(req: RequestLike) {
  const url = typeof req.url === "string" ? req.url.split(/[?#]/)[0] : req.url;
  return { method: req.method, url, host: req.host ?? req.hostname };
}

/**
 * The arguments of a log call with a database error in `err` (or as the first argument) replaced
 * by its copy without values (`withoutDatabaseValues`). Before pino serializes the line, so
 * Sentry's pino integration, which captures the `err` of the call itself, gets the copy too.
 */
function withoutDatabaseErrorValues(args: unknown[]): unknown[] {
  const [first, ...rest] = args;
  if (first instanceof Error) {
    const safe = withoutDatabaseValues(first);
    return safe === first ? args : [safe, ...rest];
  }
  if (typeof first !== "object" || first === null || !("err" in first)) return args;
  const safe = withoutDatabaseValues(first.err);
  return safe === first.err ? args : [{ ...first, err: safe }, ...rest];
}

export function createLoggerFor(options: {
  service: string;
  level: LogLevel;
  destination?: { write(line: string): void };
}): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      formatters: { level: (label) => ({ level: label }) },
      hooks: {
        logMethod(args, method) {
          method.apply(this, withoutDatabaseErrorValues(args) as Parameters<typeof method>);
        },
        streamWrite: scrub,
      },
      serializers: {
        err: serializeError,
        req: serializeRequest,
        res: (res: { statusCode?: unknown }) => ({ statusCode: res.statusCode }),
      },
    },
    options.destination ?? pino.destination({ dest: 1, sync: true }),
  );
}

export function createLogger(options: LoggerOptions): Logger {
  return createLoggerFor(options);
}
