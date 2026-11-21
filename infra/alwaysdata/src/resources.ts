import type { ResourceKind } from "./api.ts";
import {
  databaseName,
  environmentDirectory,
  environments,
  sshUserName,
  type EnvironmentName,
} from "./environments.ts";

/**
 * The Alwaysdata resources of one environment.
 *
 * Field names and values marked UNVERIFIED are not named in the public API documentation.
 * Confirm them against the real account with `pnpm infra:provision --environment <env>
 * --inspect`; if they differ, only this file changes.
 */

export type Identity = { field: string; value: string };

const referenceTag = Symbol("reference");

/** A field value that is the id of another resource, known once that resource exists. */
export type ResourceReference = {
  readonly [referenceTag]: true;
  kind: ResourceKind;
  identity: Identity;
};

export function idOf(kind: ResourceKind, identity: Identity): ResourceReference {
  return { [referenceTag]: true, kind, identity };
}

export function isReference(value: unknown): value is ResourceReference {
  return typeof value === "object" && value !== null && referenceTag in value;
}

export type DesiredResource = {
  kind: ResourceKind;
  /** The field that finds the resource in the list; it is in `fields` too. */
  identity: Identity;
  fields: Record<string, unknown>;
  /** Set only on create; a difference afterwards is a conflict for a human, never an update. */
  createOnly?: string[];
  /** Sent on create, never compared (the API does not return it); sent again only on rotation. */
  writeOnly?: string[];
};

export function desiredResources(
  account: string,
  env: EnvironmentName,
  databasePassword: string,
): DesiredResource[] {
  const environment = environments[env];
  const directory = environmentDirectory(env);
  const database = databaseName(account, env);
  const sshUser: Identity = { field: "name", value: sshUserName(account) };

  const service = (program: "api" | "worker"): DesiredResource => {
    const annotation = `padvinder-${program} (${env})`;
    return {
      kind: "service",
      identity: { field: "annotation", value: annotation },
      fields: {
        annotation,
        command: `node --env-file=release.env --env-file=/home/${account}/${directory}/.env ${program}/dist/main.js`,
        working_directory: `${directory}/current`,
        // UNVERIFIED: the format of `environment` ("NAME=value" pairs separated by spaces,
        // per the help pages; quoting is not documented).
        environment: "NODEJS_VERSION=24",
        // UNVERIFIED: whether a listed service shows `ssh_user` as an id (assumed) or an object.
        ssh_user: idOf("ssh", sshUser),
      },
    };
  };

  return [
    {
      // One SSH user per account, shared by both environments; the maintainer adds its
      // public key in the Alwaysdata panel.
      kind: "ssh",
      identity: sshUser,
      fields: {
        name: sshUser.value,
        // UNVERIFIED: the value's spelling; the API documentation lists BASH, ZSH, ... as choices.
        shell: "BASH",
        can_use_password: false,
        // UNVERIFIED: that "" means the account root `/home/<account>`, so the server paths
        // `padvinder/<env>/...` are relative to it; the API may report it as "/" instead.
        home_directory: "",
      },
    },
    {
      kind: "database",
      identity: { field: "name", value: database },
      fields: {
        name: database,
        type: "POSTGRESQL",
        // UNVERIFIED: the API documentation names no fields for encoding, locale and
        // extensions; these are guesses from the panel's create form.
        encoding: "UTF8",
        locale: "C.UTF-8",
        extensions: ["postgis"],
      },
      createOnly: ["type", "encoding", "locale", "extensions"],
    },
    {
      kind: "database/user",
      identity: { field: "name", value: database },
      fields: {
        name: database,
        type: "POSTGRESQL",
        password: databasePassword,
        // UNVERIFIED: the documentation is unclear whether the keys are database names
        // (assumed) or ids.
        permissions: { [database]: "FULL" },
      },
      createOnly: ["type"],
      writeOnly: ["password"],
    },
    {
      kind: "site",
      identity: { field: "name", value: `padvinder-${env}` },
      fields: {
        name: `padvinder-${env}`,
        type: "reverse_proxy",
        // UNVERIFIED: whether the API keeps the order; lists of plain values are compared as
        // sets, so another order is not a change.
        addresses: environment.addresses,
        ssl_force: true,
        // UNVERIFIED: the field name of a reverse proxy's target URL, and whether the proxy
        // accepts the services hostname (services are reachable over IPv6 only).
        remote_url: `http://services-${account}.alwaysdata.net:${environment.apiPort}`,
      },
    },
    service("api"),
    service("worker"),
  ];
}
