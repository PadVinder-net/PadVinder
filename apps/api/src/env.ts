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

const apiEnvSchema = z
  .object({
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
    AUTH_SECRET: z.string().min(32, "needs at least 32 characters"),
    // The origin users open in the browser; Better Auth builds its base URL from it.
    PUBLIC_ORIGIN: z.string().refine(isOrigin, {
      error: "is not an origin: use scheme, host and optional port, without a path",
    }),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    MAIL_FROM: z.string().min(1),
    // Only for local development and tests: it must never be switched off on a public origin.
    LOGIN_RATE_LIMITS: z.enum(["on", "off"]).default("on"),
  })
  .check((ctx) => {
    const env = ctx.value;
    if (!env.ALLOWED_ORIGINS.includes(env.PUBLIC_ORIGIN)) {
      ctx.issues.push({
        code: "custom",
        message: "must be one of ALLOWED_ORIGINS",
        path: ["PUBLIC_ORIGIN"],
        input: env.PUBLIC_ORIGIN,
      });
    }
    if (env.LOGIN_RATE_LIMITS === "off" && new URL(env.PUBLIC_ORIGIN).protocol === "https:") {
      ctx.issues.push({
        code: "custom",
        message: "cannot be off when PUBLIC_ORIGIN uses https",
        path: ["LOGIN_RATE_LIMITS"],
        input: env.LOGIN_RATE_LIMITS,
      });
    }
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
