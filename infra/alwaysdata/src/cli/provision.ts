// Creates and updates the Alwaysdata resources of one environment, and writes its env file.
// Usage: pnpm infra:provision --environment <staging|production> [--apply [--rotate-password]]
//        pnpm infra:provision --environment <staging|production> --inspect
// Reads ALWAYSDATA_ACCOUNT, ALWAYSDATA_API_KEY, DATABASE_PASSWORD, DEPLOY_SSH_KEY_FILE and
// SSH_KNOWN_HOSTS_FILE from the environment. Its output may land in a public log: every line
// goes through redact(), and the account name shows as <account>.
import { createHash } from "node:crypto";
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
import { desiredResources, type DesiredResource } from "../resources.ts";

export type ProvisionArgs = {
  environment: EnvironmentName;
  apply: boolean;
  rotatePassword: boolean;
  inspect: boolean;
};

export const usage = `Usage: pnpm infra:provision --environment <staging|production> [--apply [--rotate-password]]
       pnpm infra:provision --environment <staging|production> --inspect

  --apply            Carry out the plan, then write the env file on the server.
                     Without it nothing changes.
  --rotate-password  Send the database password again, also to an existing database user.
                     If you changed DATABASE_PASSWORD, pass --rotate-password. Needs
                     --apply. Without it, --apply refuses to write a password to the
                     env file that differs from the one already there.
  --inspect          Only print, per kind, the field names and value types of the
                     account's resources, and the values of the fields provisioning
                     manages on its own resources, to confirm the names in resources.ts.`;

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
  if (values["rotate-password"] && !values.apply) {
    throw new UsageError("--rotate-password changes the password: pass --apply too.");
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
    const unverified =
      change.unverified && change.unverified.length > 0
        ? `; cannot verify ${change.unverified.join(", ")}: the API does not report it`
        : "";
    return `${change.action.padEnd(8)} ${change.kind.padEnd(13)} ${change.identity}${detail}${unverified}`;
  });
}

const inspectedKinds: ResourceKind[] = ["ssh", "database", "database/user", "site", "service"];
const sensitiveFieldPattern = /password|secret|key|token/i;

/** The JSON type of a value, without the value: `string`, `number[]`, `object{id: number}`. */
export function shapeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const elements = [...new Set(value.map(shapeOf))].sort();
    if (elements.length === 0) return "unknown[]";
    return elements.length === 1 ? `${elements[0]}[]` : `(${elements.join(" | ")})[]`;
  }
  if (typeof value === "object") {
    // Keys stay: they show the structure. For a dictionary such as a database user's
    // permissions they are database names, which Alwaysdata shows to every tenant anyway.
    const fields = Object.entries(value).map(([name, field]) => `${name}: ${shapeOf(field)}`);
    return `object{${fields.join(", ")}}`;
  }
  return typeof value;
}

/** `A=1 B=2` becomes `A=<value> B=<value>`: the names, never the values. */
function environmentNames(value: unknown): unknown {
  if (typeof value !== "string") return shapeOf(value);
  return value
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => {
      const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(word)?.[1];
      return name === undefined ? "<value>" : `${name}=<value>`;
    })
    .join(" ");
}

/**
 * What `--inspect` prints. The output may land in a public log, so other resources only
 * show field names and value types, never values (their environment, commands and
 * addresses are not ours to publish). Only for our own resources (matched by identity) does
 * it show the values of the fields provisioning manages, without write-only or
 * password-like fields, and with only the variable names of `environment`.
 */
export async function inspectAccount(
  api: AlwaysdataApi,
  desired: readonly DesiredResource[],
): Promise<Record<string, { fields: Record<string, string>; ours: Record<string, unknown>[] }>> {
  const result: Record<
    string,
    { fields: Record<string, string>; ours: Record<string, unknown>[] }
  > = {};
  for (const kind of inspectedKinds) {
    const resources = await api.list(kind);
    const shapes = new Map<string, Set<string>>();
    for (const resource of resources) {
      for (const [name, value] of Object.entries(resource)) {
        const set = shapes.get(name) ?? new Set<string>();
        set.add(shapeOf(value));
        shapes.set(name, set);
      }
    }
    const fields = Object.fromEntries(
      [...shapes.entries()].map(([name, set]) => [name, [...set].sort().join(" | ")]),
    );

    const ours: Record<string, unknown>[] = [];
    for (const want of desired.filter((d) => d.kind === kind)) {
      for (const resource of resources) {
        if (resource[want.identity.field] !== want.identity.value) continue;
        const shown: Record<string, unknown> = { id: resource.id };
        for (const name of Object.keys(want.fields)) {
          if (want.writeOnly?.includes(name)) continue;
          const value = resource[name];
          // A password-like name may still hold a harmless flag, such as can_use_password.
          if (sensitiveFieldPattern.test(name) && typeof value !== "boolean") continue;
          shown[name] =
            value === undefined
              ? "<absent>"
              : name === "environment"
                ? environmentNames(value)
                : value;
        }
        ours.push(shown);
      }
    }
    result[kind] = { fields, ours };
  }
  return result;
}

/** The SHA-256 of a remote file, or undefined when it does not exist. */
async function remoteChecksum(remote: Remote, path: string): Promise<string | undefined> {
  const { stdout } = await remote.exec(`if [ -f ${path} ]; then sha256sum < ${path}; fi`);
  return /\b([0-9a-f]{64})\b/.exec(stdout)?.[1];
}

/** The DATABASE_URL in a remote env file, or undefined when there is none. Never print it. */
async function remoteDatabaseUrl(remote: Remote, path: string): Promise<string | undefined> {
  const { stdout } = await remote.exec(
    `if [ -f ${path} ]; then grep -m 1 '^DATABASE_URL=' ${path} || true; fi`,
  );
  return /^DATABASE_URL=(.*)$/m.exec(stdout)?.[1];
}

const databaseUrlOf = (envFile: string) => /^DATABASE_URL=(.*)$/m.exec(envFile)?.[1];

export const passwordMismatchMessage =
  "The database password in GitHub differs from the one on the server. Run Provision again with rotate-password, or restore the old secret.";

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
      // No password is needed to find our resources; write-only fields are never shown.
      const desired = desiredResources(config.account, args.environment, "");
      print(JSON.stringify(await inspectAccount(api, desired), null, 2));
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

    await applyPlan(api, desired, plan, { warn: (message) => print(`Warning: ${message}`) });
    print("Applied the plan.");
    const directory = environmentDirectory(env);
    const content = renderEnvFile({ account: config.account, env, databasePassword });
    const sshHint = () =>
      print(
        `Could not write ${directory}/.env over SSH. On the first run, add the deploy public key to SSH user ${sshUserName(config.account)} in the Alwaysdata panel, then run again with --apply.`,
      );
    let remote: Remote;
    let existingDatabaseUrl: string | undefined;
    let before: string | undefined;
    try {
      remote = input.remote();
      existingDatabaseUrl = await remoteDatabaseUrl(remote, `${directory}/.env`);
      before = await remoteChecksum(remote, `${directory}/.env`);
    } catch (error) {
      sshHint();
      throw error;
    }
    // Without --rotate-password the existing database user keeps its old password, so a new
    // password in the env file would break the next restart, and the rollback with it.
    if (
      !args.rotatePassword &&
      existingDatabaseUrl !== undefined &&
      existingDatabaseUrl !== databaseUrlOf(content)
    ) {
      print(passwordMismatchMessage);
      return 1;
    }
    const envFileChanged = before !== createHash("sha256").update(content).digest("hex");
    try {
      await remote.writeFile(`${directory}/.env`, content, 0o600);
      await remote.exec(`mkdir -p -- ${directory}/releases`);
    } catch (error) {
      sshHint();
      throw error;
    }
    print(`Wrote ${directory}/.env and created ${directory}/releases on the server.`);
    const passwordRotated = plan.some(
      (change) => change.action === "update" && change.fields?.includes("password"),
    );
    if (envFileChanged || passwordRotated) {
      print(
        `The services must be restarted to use the new ${passwordRotated ? "database password" : "env file"}: pnpm infra:services --environment ${env} --restart`,
      );
    }
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
