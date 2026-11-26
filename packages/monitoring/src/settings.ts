import { DsnError, parseDsn } from "./dsn";

export const DEPLOYMENT_ENVIRONMENTS = ["production", "staging", "development"] as const;
export type DeploymentEnvironment = (typeof DEPLOYMENT_ENVIRONMENTS)[number];

export type MonitoringSettings = {
  /** Sentry is off when this is undefined. */
  dsn: string | undefined;
  /**
   * The browser project's DSN (`SENTRY_BROWSER_DSN`): where the API's tunnel and problem reports
   * send. The tunnel and problem reports are off when this is undefined.
   */
  browserDsn: string | undefined;
  environment: DeploymentEnvironment;
  /** The git commit of the release. */
  release: string;
};

function invalid(variable: string, problem: string): Error {
  // Never the value: a DSN holds the project's key.
  return new Error(`Invalid monitoring settings: ${variable}: ${problem}`);
}

function readDsn(variable: string, value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  try {
    parseDsn(value);
  } catch (error) {
    throw invalid(variable, error instanceof DsnError ? error.message : "not a DSN");
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

/** Reads `SENTRY_DSN`, `SENTRY_BROWSER_DSN`, `PADVINDER_ENVIRONMENT` and `GIT_COMMIT`. */
export function readMonitoringSettings(
  source: Record<string, string | undefined>,
): MonitoringSettings {
  return {
    dsn: readDsn("SENTRY_DSN", source.SENTRY_DSN),
    browserDsn: readDsn("SENTRY_BROWSER_DSN", source.SENTRY_BROWSER_DSN),
    environment: readEnvironment(source.PADVINDER_ENVIRONMENT),
    release: source.GIT_COMMIT || "dev",
  };
}
