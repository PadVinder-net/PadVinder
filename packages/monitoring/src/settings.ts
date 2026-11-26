export const DEPLOYMENT_ENVIRONMENTS = ["production", "staging", "development"] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export type MonitoringSettings = {
  /** Sentry is off when this is undefined. */
  dsn: string | undefined;
  environment: DeploymentEnvironment;
  /** The git commit of the release. */
  release: string;
};

function invalid(variable: string, problem: string): Error {
  // Never the value: a DSN holds the project's key.
  return new Error(`Invalid monitoring settings: ${variable}: ${problem}`);
}

function readDsn(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid("SENTRY_DSN", "not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalid("SENTRY_DSN", "must use https or http");
  }
  return value;
}

function isDeploymentEnvironment(value: string): value is DeploymentEnvironment {
  return (DEPLOYMENT_ENVIRONMENTS as readonly string[]).includes(value);
}

function readEnvironment(value: string | undefined): DeploymentEnvironment {
  if (value === undefined || value === "") return "development";
  if (!isDeploymentEnvironment(value)) {
    throw invalid("PADVINDER_ENVIRONMENT", `must be one of ${DEPLOYMENT_ENVIRONMENTS.join(", ")}`);
  }
  return value;
}

/** Reads `SENTRY_DSN`, `PADVINDER_ENVIRONMENT` and `GIT_COMMIT`. */
export function readMonitoringSettings(
  source: Record<string, string | undefined>,
): MonitoringSettings {
  return {
    dsn: readDsn(source.SENTRY_DSN),
    environment: readEnvironment(source.PADVINDER_ENVIRONMENT),
    release: source.GIT_COMMIT || "dev",
  };
}
