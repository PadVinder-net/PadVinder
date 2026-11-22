import type { Identity, ResourceKind } from "./api.ts";
import {
  databaseName,
  environmentDirectory,
  environments,
  sshUser,
  type EnvironmentName,
} from "./environments.ts";

/**
 * The Alwaysdata resources of one environment.
 *
 * Field names and values marked UNVERIFIED are not named in the public API documentation.
 * Confirm them against the real account with `pnpm infra:provision --environment <env>
 * --inspect`; if they differ, only this file changes.
 */

export type ServiceProgram = "api" | "worker";

/** The annotation that identifies a service: `padvinder-api (staging)`. */
export const serviceAnnotation = (program: ServiceProgram, env: EnvironmentName) =>
  `padvinder-${program} (${env})`;

/**
 * UNVERIFIED: the name of a service's on/off field. Deploys turn a disabled service on
 * (staging may be switched off); `pnpm infra:services` turns services on and off.
 */
export const serviceDisabledField = "is_disabled";

export type DesiredResource = {
  kind: ResourceKind;
  /**
   * The field that finds the resource in the list; it is in `fields` too. A list field
   * matches when it contains the value (see `matchesIdentity`).
   */
  identity: Identity;
  /** The values to send on create, and to compare with afterwards. */
  fields: Record<string, unknown>;
  /**
   * Fields whose desired value depends on what the server holds: compared with, and sent on
   * update as, the value computed from the current one. `fields` still holds the create value.
   */
  derived?: Record<string, (current: unknown) => unknown>;
  /** Set only on create; a difference afterwards is a conflict for a human, never an update. */
  createOnly?: string[];
  /** Sent on create, never compared (the API does not return it); sent again only on rotation. */
  writeOnly?: string[];
};

/**
 * The permissions a database user should have: FULL on its own database, NONE on every other
 * database the API lists. The API keys `permissions` by database name and lists every
 * database of the account (confirmed 22 November 2026, `--inspect`), so setting the others to
 * NONE keeps the staging user out of production's database and the other way round. A
 * database the API does not list is left out: the user has no rights on it anyway.
 */
export function databaseUserPermissions(
  ownDatabase: string,
  current: unknown,
): Record<string, string> {
  const listed =
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? Object.keys(current)
      : [];
  return {
    ...Object.fromEntries(listed.map((database) => [database, "NONE"])),
    [ownDatabase]: "FULL",
  };
}

/**
 * The account's main SSH user, which Alwaysdata creates with the account and names exactly
 * like it. Provisioning only reads it, never creates or changes it: both services run as it.
 */
export const mainSshUserIdentity = (account: string): Identity => ({
  field: "name",
  value: sshUser(account),
});

/**
 * The id a reference field of a listed resource points at, such as a service's `ssh_user`.
 * The API documentation calls it "the id of an SSH user", so a number is expected; an object
 * with `id` or `href`, or an href such as `/v1/ssh/12/`, is accepted too, as other API
 * references look like that. Undefined for anything else. UNVERIFIED: which form the API
 * returns; `--inspect` shows it.
 */
export function referencedId(value: unknown): number | undefined {
  const fromHref = (href: unknown) => {
    const id = typeof href === "string" ? /\/(\d+)\/?$/.exec(href)?.[1] : undefined;
    return id === undefined ? undefined : Number(id);
  };
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  if (typeof value === "string") return fromHref(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { id, href } = value as { id?: unknown; href?: unknown };
    if (typeof id === "number" && Number.isInteger(id)) return id;
    return fromHref(href);
  }
  return undefined;
}

export type DesiredResourcesInput = {
  databasePassword: string;
  /** The id of the account's main SSH user (see `mainSshUserIdentity`); the services run as it. */
  mainSshUserId: number;
};

/** A host as Alwaysdata stores it on a site: with the root path, `example.org/`. */
export function siteAddress(host: string): string {
  return host.endsWith("/") ? host : `${host}/`;
}

export function desiredResources(
  account: string,
  env: EnvironmentName,
  { databasePassword, mainSshUserId }: DesiredResourcesInput,
): DesiredResource[] {
  const environment = environments[env];
  const directory = environmentDirectory(env);
  const database = databaseName(account, env);
  // Alwaysdata stores a site address as host plus path, the root being `/`: it returns
  // `staging.padvinder.net/` for `staging.padvinder.net` (22 November 2026). Send and match
  // that form, so the site is found and its addresses compare equal.
  const siteAddresses = environment.addresses.map(siteAddress);
  const [firstAddress] = siteAddresses;
  if (firstAddress === undefined) throw new Error(`The ${env} environment has no address`);

  const service = (program: ServiceProgram): DesiredResource => {
    const annotation = serviceAnnotation(program, env);
    return {
      kind: "service",
      identity: { field: "annotation", value: annotation },
      fields: {
        annotation,
        // The working directory resolves to `releases/<name>`, so `../../.env` is the
        // environment's env file, the same file the migrations read; it does not depend on
        // the account's home directory.
        command: `node --env-file=release.env --env-file=../../.env ${program}/dist/main.js`,
        working_directory: `${directory}/current`,
        // UNVERIFIED: the format of `environment` ("NAME=value" pairs separated by spaces,
        // per the help pages; quoting is not documented).
        environment: "NODEJS_VERSION=24",
        // The API requires `ssh_user` (confirmed 22 November 2026: a service without it is
        // refused with 400). The services run explicitly as the account's main SSH user, the
        // owner of the releases and the env file.
        ssh_user: mainSshUserId,
      },
      // A listed `ssh_user` that points at the main user is left as the API shows it, in
      // whatever form (see `referencedId`); any other value is updated to the id.
      derived: {
        ssh_user: (current) => (referencedId(current) === mainSshUserId ? current : mainSshUserId),
      },
    };
  };

  return [
    {
      kind: "database",
      identity: { field: "name", value: database },
      fields: {
        name: database,
        type: "POSTGRESQL",
        // `locale` and `extensions` are the API's names and formats (confirmed 22 November
        // 2026, `--inspect`). The API has no encoding field; the migrate step's check of
        // encoding and locale stays the hard gate, before anything is written.
        locale: "C.UTF-8",
        extensions: ["postgis"],
      },
      createOnly: ["type", "locale", "extensions"],
    },
    {
      kind: "database/user",
      identity: { field: "name", value: database },
      fields: {
        name: database,
        type: "POSTGRESQL",
        password: databasePassword,
        // Keyed by database name (confirmed 22 November 2026, `--inspect`).
        permissions: databaseUserPermissions(database, undefined),
      },
      derived: { permissions: (current) => databaseUserPermissions(database, current) },
      createOnly: ["type"],
      writeOnly: ["password"],
    },
    {
      kind: "site",
      // Found by its first address: the API does not keep the `name` sent on create (22
      // November 2026, `--inspect`), so a name would neither find the site nor stay equal.
      // No name is sent at all.
      identity: { field: "addresses", value: firstAddress },
      fields: {
        type: "reverse_proxy",
        // UNVERIFIED: whether the API keeps the order; lists of plain values are compared as
        // sets, so another order is not a change.
        addresses: siteAddresses,
        ssl_force: true,
        // The reverse proxy's target is `url`: the API rejects a reverse_proxy site without it
        // (22 November 2026). UNVERIFIED: whether the proxy accepts the services hostname
        // (services are reachable over IPv6 only).
        url: `http://services-${account}.alwaysdata.net:${environment.apiPort}`,
      },
    },
    service("api"),
    service("worker"),
  ];
}
