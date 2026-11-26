import { createLoggerFor, type Logger, type LogLevel } from "./logger";

export function createTestLogger(level: LogLevel = "debug"): {
  logger: Logger;
  entries(): Array<Record<string, unknown>>;
  text(): string;
} {
  const lines: string[] = [];
  const logger = createLoggerFor({
    service: "test",
    level,
    destination: { write: (line) => void lines.push(line) },
  });
  return {
    logger,
    entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    text: () => lines.join(""),
  };
}
