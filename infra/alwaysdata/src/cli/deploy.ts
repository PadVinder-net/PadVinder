// Deploys a release tarball to one environment: upload, migrate, switch, restart, health
// check, and a rollback when the health check fails.
// Usage: pnpm infra:deploy --environment <staging|production> --tarball <path> --commit <sha>
//          [--health-url <url>]
// Reads ALWAYSDATA_ACCOUNT, ALWAYSDATA_API_KEY, SSH_KNOWN_HOSTS_FILE, and
// DEPLOY_SSH_AGENT_SOCK or DEPLOY_SSH_KEY_FILE from the environment. Its output lands in a
// public log: every line goes through redactForLog(): secrets are hidden, IP addresses show
// as <ip> and the account name as <account>.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify } from "node:util";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import { loadInfraConfig, type InfraConfig } from "../config.ts";
import { deploy, type DeployOptions } from "../deploy.ts";
import { environments, isEnvironmentName, type EnvironmentName } from "../environments.ts";
import { redactForLog } from "../redact.ts";
import { createSshRemote, type Remote } from "../remote.ts";

const run = promisify(execFile);

export type DeployArgs = {
  environment: EnvironmentName;
  tarball: string;
  commit: string;
  healthUrl?: string;
};

export const usage = `Usage: pnpm infra:deploy --environment <staging|production> --tarball <path> --commit <sha> [--health-url <url>]

  --tarball     The release, padvinder-release.tar.gz from pnpm release:build.
  --commit      The full commit the release was built from; release/release.env must name it.
  --health-url  Where to check the health of the new release. Default: https://<the
                environment's first address>.`;

export class UsageError extends Error {
  constructor(problem: string) {
    super(`${problem}\n\n${usage}`);
    this.name = "UsageError";
  }
}

const parseOptions = {
  environment: { type: "string" },
  tarball: { type: "string" },
  commit: { type: "string" },
  "health-url": { type: "string" },
} as const;

export function parseDeployArgs(argv: string[]): DeployArgs {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof parseOptions }>>;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: parseOptions,
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  const environment = values.environment;
  if (environment === undefined || !isEnvironmentName(environment)) {
    throw new UsageError("--environment must be staging or production.");
  }
  if (values.tarball === undefined || values.tarball === "") {
    throw new UsageError("--tarball is required.");
  }
  if (values.commit === undefined || !/^[0-9a-f]{40}$/.test(values.commit)) {
    throw new UsageError("--commit must be a full commit: 40 lowercase hexadecimal characters.");
  }
  const args: DeployArgs = { environment, tarball: values.tarball, commit: values.commit };
  const healthUrl = values["health-url"];
  if (healthUrl !== undefined) {
    if (!URL.canParse(healthUrl) || !/^https?:$/.test(new URL(healthUrl).protocol)) {
      throw new UsageError("--health-url must be an http or https URL.");
    }
    args.healthUrl = healthUrl;
  }
  return args;
}

/** Unpacks the tarball, deploys it and returns the exit code. Every printed line is redacted. */
export async function runDeploy(input: {
  args: DeployArgs;
  config: InfraConfig;
  api: AlwaysdataApi;
  remote: () => Remote;
  print: (line: string) => void;
  health?: DeployOptions["health"];
}): Promise<number> {
  const { args, config } = input;
  const print = (text: string) => input.print(redactForLog(text, [config.apiKey], config.account));
  const workDir = await mkdtemp(join(tmpdir(), "padvinder-release-"));
  try {
    await run("tar", ["-xzf", args.tarball, "-C", workDir]);
    const releaseDir = join(workDir, "release");
    if (!existsSync(join(releaseDir, "release.env"))) {
      throw new Error(`${args.tarball} holds no release/ directory with a release.env`);
    }
    await deploy({
      env: args.environment,
      commit: args.commit,
      releaseDir,
      api: input.api,
      remote: input.remote(),
      healthUrl: args.healthUrl ?? `https://${environments[args.environment].addresses[0]}`,
      log: print,
      health: input.health,
    });
    return 0;
  } catch (error) {
    print(`Deploy failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  let args: DeployArgs;
  try {
    args = parseDeployArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let config: InfraConfig;
  try {
    config = loadInfraConfig(process.env, args.environment, { envFileSecrets: false, ssh: true });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return runDeploy({
    args,
    config,
    api: createAlwaysdataApi({ apiKey: config.apiKey, account: config.account }),
    remote: () => {
      if (!config.ssh) throw new Error("The SSH settings are missing");
      return createSshRemote({ ...config.ssh, secrets: [config.apiKey] });
    },
    print: (line) => console.log(line),
  });
}

if (import.meta.main) process.exitCode = await main();
