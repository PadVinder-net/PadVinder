// Creates and updates the Alwaysdata resources of one environment, and writes its env file.
// Usage: pnpm infra:provision --environment <staging|production> [--apply] [--rotate-password]
//        pnpm infra:provision --environment <staging|production> --inspect
// Reads ALWAYSDATA_ACCOUNT, ALWAYSDATA_API_KEY, DATABASE_PASSWORD, DEPLOY_SSH_KEY_FILE and
// SSH_KNOWN_HOSTS_FILE from the environment. Its output may land in a public log: every line
// goes through redact(), and the account name shows as <account>.
import { parseArgs } from "node:util";
import { createAlwaysdataApi, type AlwaysdataApi, type ResourceKind } from "../api.ts";
import { loadInfraConfig, type InfraConfig } from "../config.ts";
import { renderEnvFile } from "../env-file.ts";
import {
  environmentDirectory,
  isEnvironmentName,
  sshUserName,
  type EnvironmentName,
} from "../environments.ts";
import { applyPlan, planResources, type PlannedChange } from "../reconcile.ts";
import { redact } from "../redact.ts";
import { createSshRemote, type Remote } from "../remote.ts";
import { desiredResources } from "../resources.ts";

export type ProvisionArgs = {
  environment: EnvironmentName;
  apply: boolean;
  rotatePassword: boolean;
  inspect: boolean;
};

export const usage = `Usage: pnpm infra:provision --environment <staging|production> [--apply] [--rotate-password]
       pnpm infra:provision --environment <staging|production> --inspect

  --apply            Carry out the plan, then write the env file on the server.
                     Without it nothing changes.
  --rotate-password  Send the database password again, also to an existing database user.
  --inspect          Only list every resource of each kind as JSON, without password-like
                     fields, to confirm the field names in resources.ts.`;

export class UsageError extends Error {
  constructor(problem: string) {
    super(`${problem}\n\n${usage}`);
    this.name = "UsageError";
  }
}

const parseOptions = {
  environment: { type: "string" },
  apply: { type: "boolean", default: false },
  "rotate-password": { type: "boolean", default: false },
  inspect: { type: "boolean", default: false },
} as const;

export function parseProvisionArgs(argv: string[]): ProvisionArgs {
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
  if (values.inspect && (values.apply || values["rotate-password"])) {
    throw new UsageError("--inspect changes nothing; leave out --apply and --rotate-password.");
  }
  return {
    environment,
    apply: values.apply,
    rotatePassword: values["rotate-password"],
    inspect: values.inspect,
  };
}

/** One line per change, with field names but never field values. */
export function formatPlan(plan: readonly PlannedChange[]): string[] {
  return plan.map((change) => {
    const detail =
      change.action === "conflict"
        ? `: ${change.reason ?? ""}`
        : change.fields && change.action !== "ok"
          ? ` (${change.fields.join(", ")})`
          : "";
    return `${change.action.padEnd(8)} ${change.kind.padEnd(13)} ${change.identity}${detail}`;
  });
}

const inspectedKinds: ResourceKind[] = ["ssh", "database", "database/user", "site", "service"];
const sensitiveFieldPattern = /password|secret|key|token/i;

function withoutSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSensitiveFields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !sensitiveFieldPattern.test(name))
      .map(([name, field]) => [name, withoutSensitiveFields(field)]),
  );
}

/** Runs the provisioning and returns the exit code. Every printed line is redacted. */
export async function runProvision(input: {
  args: ProvisionArgs;
  config: InfraConfig;
  api: AlwaysdataApi;
  /** Called only when applying. */
  remote: () => Remote;
  print: (line: string) => void;
}): Promise<number> {
  const { args, config, api } = input;
  const secrets = [config.apiKey, config.databasePassword ?? ""];
  const print = (text: string) =>
    input.print(redact(text, secrets).replaceAll(config.account, "<account>"));

  try {
    if (args.inspect) {
      const inspected: Record<string, unknown> = {};
      for (const kind of inspectedKinds) {
        inspected[kind] = withoutSensitiveFields(await api.list(kind));
      }
      print(JSON.stringify(inspected, null, 2));
      return 0;
    }

    const databasePassword = config.databasePassword;
    if (databasePassword === undefined) throw new Error("DATABASE_PASSWORD is not set");
    const env = args.environment;
    const desired = desiredResources(config.account, env, databasePassword);
    const plan = await planResources(api, desired, { rotatePassword: args.rotatePassword });
    print(`Plan for ${env}:`);
    for (const line of formatPlan(plan)) print(`  ${line}`);

    if (plan.some((change) => change.action === "conflict")) {
      print("The plan has conflicts. Nothing was changed; resolve them in the Alwaysdata panel.");
      return 1;
    }
    if (!args.apply) {
      print("Nothing was changed. Run again with --apply to carry out the plan.");
      return 0;
    }

    await applyPlan(api, desired, plan);
    print("Applied the plan.");
    const directory = environmentDirectory(env);
    try {
      const remote = input.remote();
      await remote.writeFile(
        `${directory}/.env`,
        renderEnvFile({ account: config.account, env, databasePassword }),
        0o600,
      );
      await remote.exec(`mkdir -p -- ${directory}/releases`);
    } catch (error) {
      print(
        `Could not write ${directory}/.env over SSH. On the first run, add the deploy public key to SSH user ${sshUserName(config.account)} in the Alwaysdata panel, then run again with --apply.`,
      );
      throw error;
    }
    print(`Wrote ${directory}/.env and created ${directory}/releases on the server.`);
    return 0;
  } catch (error) {
    print(`Provisioning failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function main(): Promise<number> {
  let args: ProvisionArgs;
  try {
    args = parseProvisionArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let config: InfraConfig;
  try {
    config = loadInfraConfig(process.env, args.environment, {
      databasePassword: !args.inspect,
      ssh: !args.inspect,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  const api = createAlwaysdataApi({ apiKey: config.apiKey, account: config.account });
  return runProvision({
    args,
    config,
    api,
    remote: () => {
      if (!config.ssh) throw new Error("The SSH settings are missing");
      return createSshRemote({
        ...config.ssh,
        secrets: [config.apiKey, config.databasePassword ?? ""],
      });
    },
    print: (line) => console.log(line),
  });
}

if (import.meta.main) process.exitCode = await main();
