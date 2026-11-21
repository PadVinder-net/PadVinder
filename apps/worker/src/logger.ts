import { LOG_LEVELS } from "./env";

type Level = (typeof LOG_LEVELS)[number];

export type Logger = Record<Level, (message: string, ...details: unknown[]) => void>;

export function createLogger(level: string): Logger {
  const threshold = LOG_LEVELS.indexOf(level as Level);
  const log =
    (name: Level, write: (...args: unknown[]) => void) =>
    (message: string, ...details: unknown[]) => {
      if (LOG_LEVELS.indexOf(name) >= threshold) {
        write(`${new Date().toISOString()} ${name} ${message}`, ...details);
      }
    };
  return {
    debug: log("debug", console.debug),
    info: log("info", console.info),
    warn: log("warn", console.warn),
    error: log("error", console.error),
  };
}
