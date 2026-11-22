import { resolve } from "node:path";
import { calVerSchema } from "@padvinder/contracts";
import { z } from "zod";

/** A browser sends `Origin` as exactly `scheme://host[:port]`, so only that form can ever match. */
function isOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

const distDirSchema = z
  .string()
  .min(1)
  .transform((path) => resolve(path));

const apiEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65535),
  // Alwaysdata services are reachable over IPv6 only, so listen on all IPv6 (and IPv4) addresses.
  API_HOST: z.string().min(1).default("::"),
  // Comma-separated in the environment; at least one origin is required.
  ALLOWED_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z.string().refine(isOrigin, {
            error: (issue) =>
              `"${String(issue.input)}" is not an origin: use scheme, host and optional port, without a path or trailing slash (like https://app.example)`,
          }),
        )
        .min(1, "needs at least one origin"),
    ),
  GIT_COMMIT: z.string().min(1).default("dev"),
  MIN_APP_VERSION: calVerSchema.default("2027.0.0"),
  // Relative to the working directory, so a release can say `mobile` and `portal`.
  MOBILE_DIST_DIR: distDirSchema.optional(),
  PORTAL_DIST_DIR: distDirSchema.optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Parses the environment and reports every problem at once, each naming its variable. */
export function loadApiEnv(source: Record<string, string | undefined>): ApiEnv {
  // An empty value (`FOO=` in a .env file) counts as not set.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const result = apiEnvSchema.safeParse(cleaned);
  if (result.success) return result.data;
  const problems = result.error.issues.map(
    (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
  );
  throw new Error(`Invalid API environment: ${problems.join("; ")}`);
}
