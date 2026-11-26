import pino from "pino";
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
      hooks: { streamWrite: scrub },
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
