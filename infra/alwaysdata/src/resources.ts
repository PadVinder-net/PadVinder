import type { ResourceKind } from "./api.ts";
import {
  databaseName,
  environmentDirectory,
  environments,
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
        // No `ssh_user`: provisioning manages no SSH user. UNVERIFIED: that a service without
        // one runs as the account's main user, the owner of the releases and the env file
        // (confirm with --inspect and the first deploy's health check).
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
