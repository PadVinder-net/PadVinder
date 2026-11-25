import { parseArgs } from "node:util";
import { z } from "zod";
import {
  AdminError,
  type AdminErrorCode,
  createOrganization,
  createWorkingGroup,
  grantCoordinator,
  grantOrganizationAdmin,
  grantPlatformAdmin,
  listOrganizations,
  normalizeEmail,
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
  working_group_inactive: "That working group is inactive; a role there gives no rights.",
  user_not_found: "There is no user with that email address.",
  invalid_email: "That is not a valid email address.",
  name_taken: "That name is already taken.",
  last_platform_admin:
    "That is the last platform admin who has logged in. Make another one, and let them log in first.",
  last_organization_admin:
    "That is the last admin of the organization. Make someone else admin first.",
  membership_not_found: "There is no membership with that ID.",
  last_coordinator:
    "That is the last coordinator of the working group. Make someone else coordinator first.",
  no_coordinator: "That working group has no coordinator. Make someone coordinator first.",
  person_outside_organization:
    "That person has an account outside the organization. Choose someone else.",
};

const helpLines = [
  "Usage: admin <command> [options]",
  "",
  "  list                                              Organizations with their working groups",
  "  create-organization --name <name> --admin-email <address> [--contact-email <address>]",
  "                                                    Prints the new ID",
  "  create-working-group --organization <id> --name <name> --city <city> --coordinator-email <address>",
  "                                                    Prints the new ID",
  "  grant-platform-admin --email <address>            Prints changed or unchanged",
  "  revoke-platform-admin --email <address>",
  "  grant-organization-admin --email <address> --organization <id>",
  "  revoke-organization-admin --email <address> --organization <id>",
  "  grant-coordinator --email <address> --working-group <id>",
  "  revoke-coordinator --email <address> --working-group <id>",
  "",
  "An organization always has an admin, and an active working group a coordinator: the last one",
  "cannot be revoked. list marks data from before that rule with [no admin] or [no coordinator].",
  "The grant commands create the account when the address is unknown: check the address carefully.",
  "Every change is written to the audit log as the system.",
];

type Handler = {
  options: readonly string[];
  /** Options that may be left out. */
  optional?: readonly string[];
  run(values: Record<string, string | undefined>, deps: AdminDeps): Promise<void>;
};

const printChange = (deps: AdminDeps, result: RoleChange, email: string) => {
  const word = result.changed ? "changed" : "unchanged";
  deps.out(result.created ? `${word} (new account for ${normalizeEmail(email)})` : word);
};

/** Options that hold an ID; a typo gets one clear line instead of a database error. */
const idOptions = new Set(["organization", "working-group"]);

const commands: Record<string, Handler> = {
  list: {
    options: [],
    async run(_values, { db, out }) {
      for (const organization of await listOrganizations(db)) {
        out(
          `organization ${organization.id} ${organization.name}${organization.hasAdmin ? "" : " [no admin]"}`,
        );
        for (const group of organization.workingGroups) {
          const mark = !group.active
            ? " [inactive]"
            : group.hasCoordinator
              ? ""
              : " [no coordinator]";
          out(`  working group ${group.id} ${group.name} (${group.city})${mark}`);
        }
      }
    },
  },
  "create-organization": {
    options: ["name", "admin-email"],
    optional: ["contact-email"],
    async run(v, { db, out }) {
      const input = {
        name: v.name!,
        adminEmail: v["admin-email"]!,
        contactEmail: v["contact-email"] ?? null,
      };
      const result = await createOrganization(db, input, system);
      out(result.id);
      if (result.adminCreated) out(`new account for ${normalizeEmail(input.adminEmail)}`);
    },
  },
  "create-working-group": {
    options: ["organization", "name", "city", "coordinator-email"],
    async run(v, { db, out }) {
      const input = {
        organizationId: v.organization!,
        name: v.name!,
        city: v.city!,
        coordinatorEmail: v["coordinator-email"]!,
      };
      const result = await createWorkingGroup(db, input, system);
      out(result.id);
      if (result.coordinatorCreated) {
        out(`new account for ${normalizeEmail(input.coordinatorEmail)}`);
      }
    },
  },
  "grant-platform-admin": {
    options: ["email"],
    async run(v, deps) {
      printChange(deps, await grantPlatformAdmin(deps.db, { email: v.email! }, system), v.email!);
    },
  },
  "revoke-platform-admin": {
    options: ["email"],
    async run(v, deps) {
      printChange(deps, await revokePlatformAdmin(deps.db, { email: v.email! }, system), v.email!);
    },
  },
  "grant-organization-admin": {
    options: ["email", "organization"],
    async run(v, deps) {
      const input = { email: v.email!, organizationId: v.organization! };
      printChange(deps, await grantOrganizationAdmin(deps.db, input, system), v.email!);
    },
  },
  "revoke-organization-admin": {
    options: ["email", "organization"],
    async run(v, deps) {
      const input = { email: v.email!, organizationId: v.organization! };
      printChange(deps, await revokeOrganizationAdmin(deps.db, input, system), v.email!);
    },
  },
  "grant-coordinator": {
    options: ["email", "working-group"],
    async run(v, deps) {
      const input = { email: v.email!, workingGroupId: v["working-group"]! };
      printChange(deps, await grantCoordinator(deps.db, input, system), v.email!);
    },
  },
  "revoke-coordinator": {
    options: ["email", "working-group"],
    async run(v, deps) {
      const input = { email: v.email!, workingGroupId: v["working-group"]! };
      printChange(deps, await revokeCoordinator(deps.db, input, system), v.email!);
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
      options: Object.fromEntries(
        [...handler.options, ...(handler.optional ?? [])].map((o) => [
          o,
          { type: "string" as const },
        ]),
      ),
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
    for (const option of handler.options) {
      if (idOptions.has(option) && !z.uuid().safeParse(given[option]).success) {
        deps.err(`${command}: --${option} must be an ID (a UUID).`);
        return 1;
      }
    }
    await handler.run(given, deps);
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
