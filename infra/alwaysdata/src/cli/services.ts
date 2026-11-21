// Turns the API and worker services of one environment on or off, or restarts them.
// Usage: pnpm infra:services --environment <staging|production> (--enable | --disable | --restart)
// Reads ALWAYSDATA_ACCOUNT and ALWAYSDATA_API_KEY from the environment. Every printed line
// goes through redact(), and the account name shows as <account>.
import { parseArgs } from "node:util";
import { createAlwaysdataApi, type AlwaysdataApi } from "../api.ts";
import { loadInfraConfig, type InfraConfig } from "../config.ts";
import { isEnvironmentName, type EnvironmentName } from "../environments.ts";
import { redact } from "../redact.ts";
import { findServices, restartServices, setServicesEnabled } from "../services.ts";

const actions = ["enable", "disable", "restart"] as const;
export type ServicesAction = (typeof actions)[number];
export type ServicesArgs = { environment: EnvironmentName; action: ServicesAction };

export const usage = `Usage: pnpm infra:services --environment <staging|production> (--enable | --disable | --restart)

  --enable   Turn the API and worker services on (staging may be switched off to save memory).
  --disable  Turn them off.
  --restart  Restart them, for example after provisioning wrote a new env file.`;

export class UsageError extends Error {
  constructor(problem: string) {
    super(`${problem}\n\n${usage}`);
    this.name = "UsageError";
  }
}

const parseOptions = {
  environment: { type: "string" },
  enable: { type: "boolean", default: false },
  disable: { type: "boolean", default: false },
  restart: { type: "boolean", default: false },
} as const;

export function parseServicesArgs(argv: string[]): ServicesArgs {
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
  const chosen = actions.filter((action) => values[action]);
  const [action] = chosen;
  if (chosen.length !== 1 || action === undefined) {
    throw new UsageError("Choose exactly one of --enable, --disable and --restart.");
  }
  return { environment, action };
}

/** Carries out the action and returns the exit code. Every printed line is redacted. */
export async function runServices(input: {
  args: ServicesArgs;
  config: InfraConfig;
  api: AlwaysdataApi;
  print: (line: string) => void;
}): Promise<number> {
  const { args, config, api } = input;
  const print = (text: string) =>
    input.print(redact(text, [config.apiKey]).replaceAll(config.account, "<account>"));
  try {
    const env = args.environment;
    if (args.action === "restart") {
      const services = await findServices(api, env);
      await restartServices(api, services);
      print(
        `Restarted ${String(services.api.annotation)} and ${String(services.worker.annotation)}. The restart may finish after this returns: check /api/health.`,
      );
    } else {
      const services = await setServicesEnabled(api, env, args.action === "enable");
      print(
        `${args.action === "enable" ? "Enabled" : "Disabled"} ${String(services.api.annotation)} and ${String(services.worker.annotation)}.`,
      );
    }
    return 0;
  } catch (error) {
    print(`Failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function main(): Promise<number> {
  let args: ServicesArgs;
  try {
    args = parseServicesArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let config: InfraConfig;
  try {
    config = loadInfraConfig(process.env, args.environment, {
      databasePassword: false,
      ssh: false,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  return runServices({
    args,
    config,
    api: createAlwaysdataApi({ apiKey: config.apiKey, account: config.account }),
    print: (line) => console.log(line),
  });
}

if (import.meta.main) process.exitCode = await main();
