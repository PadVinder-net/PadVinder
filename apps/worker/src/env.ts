import { smtpSettingsShape } from "@padvinder/mail";
import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

/** A browser sends `Origin` as exactly `scheme://host[:port]`; the API reads PUBLIC_ORIGIN the same way. */
function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const workerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // The links in the mails the worker sends: the app is `{origin}/app/`, the portal `{origin}/`.
  PUBLIC_ORIGIN: z.string().refine(isOrigin, {
    error: "is not an origin: use scheme, host and optional port, without a path",
  }),
  // The same mail settings as the API, so the worker's mails leave the same way.
  ...smtpSettingsShape,
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses the environment and reports every problem at once, each naming its variable. */
export function loadWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  // An empty value (`FOO=` in a .env file) counts as not set.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = workerEnvSchema.safeParse(cleaned);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
  );
  throw new Error(`Invalid worker environment: ${problems.join("; ")}`);
}
