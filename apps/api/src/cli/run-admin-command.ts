import { parseArgs } from "node:util";
import {
  AdminError,
  type AdminErrorCode,
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
  revokeCoordinator,
  revokeOrganizationAdmin,
  revokePlatformAdmin,
  type AuditActor,
  type Db,
  type RoleChange,
} from "@padvinder/db";

export type AdminDeps = {
  db: Db;
  out(line: string): void;
  err(line: string): void;
};

const system: AuditActor = { kind: "system" };

const adminErrorText: Record<AdminErrorCode, string> = {
  organization_not_found: "There is no organization with that ID.",
  working_group_not_found: "There is no working group with that ID.",
  user_not_found: "There is no user with that email address.",
  name_taken: "That name is already taken.",
  last_platform_admin: "That is the last platform admin. Make another one first.",
};

const helpLines = [
  "Usage: admin <command> [options]",
  "",
  "  list                                              Organizations with their working groups",
  "  create-organization --name <name>                 Prints the new ID",
  "  create-working-group --organization <id> --name <name> --city <city>",
  "                                                    Prints the new ID",
  "  grant-platform-admin --email <address>            Prints changed or unchanged",
  "  revoke-platform-admin --email <address>",
  "  grant-organization-admin --email <address> --organization <id>",
  "  revoke-organization-admin --email <address> --organization <id>",
  "  grant-coordinator --email <address> --working-group <id>",
  "  revoke-coordinator --email <address> --working-group <id>",
  "",
  "Every change is written to the audit log as the system.",
];

type Handler = {
  options: readonly string[];
  run(values: Record<string, string>, deps: AdminDeps): Promise<void>;
};

const printChange = (deps: AdminDeps, result: RoleChange) =>
  deps.out(result.changed ? "changed" : "unchanged");

const commands: Record<string, Handler> = {
  list: {
    options: [],
    async run(_values, { db, out }) {
      for (const organization of await listOrganizations(db)) {
        out(`organization ${organization.id} ${organization.name}`);
        for (const group of organization.workingGroups) {
          out(
            `  working group ${group.id} ${group.name} (${group.city})${group.active ? "" : " [inactive]"}`,
          );
        }
      }
    },
  },
  "create-organization": {
    options: ["name"],
    async run(v, { db, out }) {
      out((await createOrganization(db, { name: v.name! }, system)).id);
    },
  },
  "create-working-group": {
    options: ["organization", "name", "city"],
    async run(v, { db, out }) {
      const input = { organizationId: v.organization!, name: v.name!, city: v.city! };
      out((await createWorkingGroup(db, input, system)).id);
    },
  },
  "grant-platform-admin": {
    options: ["email"],
    async run(v, deps) {
      printChange(deps, await grantPlatformAdmin(deps.db, { email: v.email! }, system));
    },
  },
  "revoke-platform-admin": {
    options: ["email"],
    async run(v, deps) {
      printChange(deps, await revokePlatformAdmin(deps.db, { email: v.email! }, system));
    },
  },
  "grant-organization-admin": {
    options: ["email", "organization"],
    async run(v, deps) {
      const input = { email: v.email!, organizationId: v.organization! };
      printChange(deps, await grantOrganizationAdmin(deps.db, input, system));
    },
  },
  "revoke-organization-admin": {
    options: ["email", "organization"],
    async run(v, deps) {
      const input = { email: v.email!, organizationId: v.organization! };
      printChange(deps, await revokeOrganizationAdmin(deps.db, input, system));
    },
  },
  "grant-coordinator": {
    options: ["email", "working-group"],
    async run(v, deps) {
      const input = { email: v.email!, workingGroupId: v["working-group"]! };
      printChange(deps, await grantCoordinator(deps.db, input, system));
    },
  },
  "revoke-coordinator": {
    options: ["email", "working-group"],
    async run(v, deps) {
      const input = { email: v.email!, workingGroupId: v["working-group"]! };
      printChange(deps, await revokeCoordinator(deps.db, input, system));
    },
  },
};

/** Runs one admin command and returns the exit code. All output goes through `deps`. */
export async function runAdminCommand(argv: string[], deps: AdminDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "help") {
    for (const line of helpLines) deps.out(line);
    return 0;
  }
  const handler = Object.hasOwn(commands, command) ? commands[command] : undefined;
  if (!handler) {
    deps.err(`Unknown command "${command}". Run with --help for the commands.`);
    return 1;
  }
  try {
    const { values } = parseArgs({
      args: rest,
      options: Object.fromEntries(handler.options.map((o) => [o, { type: "string" as const }])),
      allowPositionals: false,
      strict: true,
    });
    const given = values as Record<string, string | undefined>;
    for (const option of handler.options) {
      if (!given[option]) {
        deps.err(`${command}: missing option --${option}`);
        return 1;
      }
    }
    await handler.run(given as Record<string, string>, deps);
    return 0;
  } catch (error) {
    if (error instanceof AdminError) {
      deps.err(`${command}: ${adminErrorText[error.code]}`);
      return 1;
    }
    if (
      error instanceof TypeError &&
      (error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      deps.err(`${command}: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
