import { z } from "zod";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

const workerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
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
