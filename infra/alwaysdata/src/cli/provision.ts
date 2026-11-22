// Creates and updates the Alwaysdata resources of one environment, and writes its env file.
// Usage: pnpm infra:provision --environment <staging|production> [--apply [--rotate-password]]
//        pnpm infra:provision --environment <staging|production> --inspect
// Reads ALWAYSDATA_ACCOUNT, ALWAYSDATA_API_KEY, DATABASE_PASSWORD, AUTH_SECRET, SMTP_USER,
// SMTP_PASSWORD, SSH_KNOWN_HOSTS_FILE, and DEPLOY_SSH_AGENT_SOCK or DEPLOY_SSH_KEY_FILE from
// the environment (--inspect only the first two). Its output may land in
// a public log: every line goes through redactForLog(): secrets are hidden, IP addresses
// show as <ip> and the account name as <account>.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import {
  createAlwaysdataApi,
  matchesIdentity,
  type AlwaysdataApi,
  type Identity,
  type ResourceKind,
} from "../api.ts";
import { loadInfraConfig, type InfraConfig } from "../config.ts";
import { renderEnvFile } from "../env-file.ts";
import {
  environmentDirectory,
  isEnvironmentName,
  sshUser,
  type EnvironmentName,
} from "../environments.ts";
import { applyPlan, findMainSshUserId, planResources, type PlannedChange } from "../reconcile.ts";
import { redactForLog } from "../redact.ts";
import { createSshRemote, type Remote } from "../remote.ts";
import { desiredResources, mainSshUserIdentity, type DesiredResource } from "../resources.ts";

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
 * password-like fields, and with only the variable names of `environment`. Of the SSH users
 * it shows only the main user's `id` and `name`: provisioning reads it, never manages it.
 */
export async function inspectAccount(
  api: AlwaysdataApi,
  desired: readonly DesiredResource[],
  mainSshUser: Identity,
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
    if (kind === "ssh") {
      for (const resource of resources) {
        if (matchesIdentity(resource, mainSshUser)) {
          ours.push({ id: resource.id, name: resource.name });
        }
      }
    }
    for (const want of desired.filter((d) => d.kind === kind)) {
      for (const resource of resources) {
        if (!matchesIdentity(resource, want.identity)) continue;
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

/** Every secret the run knows, to hide in what it prints. */
function secretsOf(config: InfraConfig): string[] {
  const { login } = config;
  return [
    config.apiKey,
    config.databasePassword ?? "",
    ...(login ? [login.authSecret, login.smtpUser, login.smtpPassword] : []),
  ];
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
  const secrets = secretsOf(config);
  const print = (text: string) => input.print(redactForLog(text, secrets, config.account));

  try {
    if (args.inspect) {
      // Only the identities and field names of the desired resources are used, so neither
      // the password nor the SSH user's id is needed; write-only fields are never shown.
      const desired = desiredResources(config.account, args.environment, {
        databasePassword: "",
        mainSshUserId: 0,
      });
      const mainSshUser = mainSshUserIdentity(config.account);
      print(JSON.stringify(await inspectAccount(api, desired, mainSshUser), null, 2));
      return 0;
    }

    const databasePassword = config.databasePassword;
    if (databasePassword === undefined) throw new Error("DATABASE_PASSWORD is not set");
    // Checked before anything is read or changed: an env file without them stops the API.
    const login = config.login;
    if (login === undefined) {
      throw new Error("AUTH_SECRET, SMTP_USER and SMTP_PASSWORD are not set");
    }
    const env = args.environment;
    // Read-only, and before anything is written: the services must name the main SSH user.
    const mainSshUserId = await findMainSshUserId(api, config.account);
    const desired = desiredResources(config.account, env, { databasePassword, mainSshUserId });
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

    const directory = environmentDirectory(env);
    const content = renderEnvFile({ account: config.account, env, databasePassword, login });

    // Read the env file before changing anything, so neither a failing SSH login nor a
    // mismatching password leaves a database password changed without the env file that
    // goes with it. The main SSH user exists from the start, so this works on the first run
    // too, when there is no env file yet.
    let remote: Remote;
    let existingDatabaseUrl: string | undefined;
    let before: string | undefined;
    try {
      remote = input.remote();
      existingDatabaseUrl = await remoteDatabaseUrl(remote, `${directory}/.env`);
      before = await remoteChecksum(remote, `${directory}/.env`);
    } catch (error) {
      print(
        `Could not read ${directory}/.env over SSH. Nothing was changed through the API. Check that the deploy public key is on the main SSH user ${sshUser(config.account)} in the Alwaysdata panel, then run again with --apply.`,
      );
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
      print("Nothing was changed.");
      return 1;
    }

    await applyPlan(api, desired, plan, { warn: (message) => print(`Warning: ${message}`) });
    print("Applied the plan.");
    const envFileChanged = before !== createHash("sha256").update(content).digest("hex");
    try {
      await remote.writeFile(`${directory}/.env`, content, 0o600);
      await remote.exec(`mkdir -p -- ${directory}/releases`);
    } catch (error) {
      // SSH worked a moment ago, so the key is in place; the plan is applied either way.
      print(
        `Could not write ${directory}/.env over SSH after applying the plan. Fix the cause below, then run again with --apply.`,
      );
      throw error;
    }
    print(`Wrote ${directory}/.env and created ${directory}/releases on the server.`);
    const passwordRotated = plan.some(
      (change) => change.action === "update" && change.fields?.includes("password"),
    );
    if (envFileChanged || passwordRotated) {
      // On the first run there is no release yet, and a restart would only make Alwaysdata
      // fail on the missing working directory. If the check fails, suggest the restart.
      let released = true;
      try {
        const { stdout } = await remote.exec(`if [ -e ${directory}/current ]; then echo yes; fi`);
        released = stdout.trim() === "yes";
      } catch {
        released = true;
      }
      if (released) {
        print(
          `The services must be restarted to use the new ${passwordRotated ? "database password" : "env file"}: pnpm infra:services --environment ${env} --restart`,
        );
      } else {
        print(
          "No release is live yet, so there is nothing to restart: the first deploy starts the services (pnpm infra:deploy, or the Deploy workflow).",
        );
      }
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
      envFileSecrets: !args.inspect,
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
        secrets: secretsOf(config),
      });
    },
    print: (line) => console.log(line),
  });
}

if (import.meta.main) process.exitCode = await main();
