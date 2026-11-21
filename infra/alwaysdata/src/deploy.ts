import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AlwaysdataApi } from "./api.ts";
import { environmentDirectory, type EnvironmentName } from "./environments.ts";
import { checkHealth, type HealthCheckOptions } from "./health-check.ts";
import type { Remote } from "./remote.ts";
import { enableDisabledServices, findServices, restartServices } from "./services.ts";

export type DeployOptions = {
  env: EnvironmentName;
  /** The full commit of the release; its `release.env` must name the same. */
  commit: string;
  /** Local directory with the unpacked release (the contents of `release/`). */
  releaseDir: string;
  api: AlwaysdataApi;
  remote: Remote;
  /** Base URL of the site, such as `https://staging.padvinder.net`. */
  healthUrl: string;
  now?: () => Date;
  /** How many of the newest releases to keep, besides `current`'s target. Default 5. */
  keepReleases?: number;
  /** One line per step. */
  log?: (line: string) => void;
  health?: Pick<HealthCheckOptions, "timeoutMs" | "intervalMs" | "fetch">;
};

/** `<UTC YYYYMMDDTHHMMSSZ>-<sha7>`: sorting the names sorts the releases by time. */
export const releaseNamePattern = /^\d{8}T\d{6}Z-[0-9a-f]{7}$/;
const commitPattern = /^[0-9a-f]{40}$/;
// Lines the deploy reads back start with this, so text a login shell prints is ignored.
const marker = "__padvinder_";

export function releaseName(now: Date, commit: string): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, "Z")
    .replaceAll(/[-:]/g, "");
  return `${stamp}-${commit.slice(0, 7)}`;
}

/** The `marker` lines of a command's output, as name -> values. */
function readMarked(stdout: string): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const [, name = "", value = ""] of stdout.matchAll(
    new RegExp(`^${marker}(\\w+)=(.*)$`, "gm"),
  )) {
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return values;
}

/**
 * The release name behind a `current` link. Deploys write `releases/<name>`; an absolute link
 * into the same environment (made by hand) is accepted too. Anything else stops the deploy.
 */
function releaseOfTarget(target: string, env: EnvironmentName): string {
  const match = new RegExp(`^(?:/.+/${environmentDirectory(env)}/)?releases/([^/]+)/?$`).exec(
    target,
  );
  const name = match?.[1];
  if (name === undefined || !releaseNamePattern.test(name)) {
    throw new Error(
      `${environmentDirectory(env)}/current points at ${JSON.stringify(target)}, not at a release in releases/. Fix the link on the server before deploying.`,
    );
  }
  return name;
}

// Every command starts with `# deploy: <step> <argument>`: a no-op for bash, and it names
// the step in an error message. The release names in them only hold [0-9A-Za-z-].
const commands = {
  prepare: (dir: string, env: EnvironmentName, name: string) =>
    [
      `# deploy: prepare ${name}`,
      "set -e",
      `if [ ! -f ${dir}/.env ]; then echo "${dir}/.env is missing. Run pnpm infra:provision --environment ${env} --apply first." >&2; exit 1; fi`,
      `mkdir -p -- ${dir}/releases`,
      `if [ -e ${dir}/releases/${name} ]; then echo "${dir}/releases/${name} already exists." >&2; exit 1; fi`,
      `if [ -L ${dir}/current ]; then`,
      `  printf '${marker}current=%s\\n' "$(readlink -- ${dir}/current)"`,
      `  if [ -f ${dir}/current/release.env ]; then printf '${marker}commit=%s\\n' "$(sed -n 's/^GIT_COMMIT=//p' ${dir}/current/release.env)"; fi`,
      `elif [ -e ${dir}/current ]; then echo "${dir}/current is not a symbolic link." >&2; exit 1; fi`,
    ].join("\n"),
  migrate: (dir: string, name: string) =>
    [
      `# deploy: migrate ${name}`,
      `cd -- ${dir}/releases/${name} && node --env-file=release.env --env-file="$HOME/${dir}/.env" api/dist/migrate.js migrations`,
    ].join("\n"),
  /** Replaces the link in one rename, so `current` is always the old or the new release. */
  switch: (dir: string, target: string) =>
    [
      `# deploy: switch ${target}`,
      `cd -- ${dir} && ln -sfn -- ${target} current.tmp && mv -T -- current.tmp current`,
    ].join("\n"),
  remove: (dir: string, name: string) =>
    [`# deploy: remove ${name}`, `rm -rf -- ${dir}/releases/${name}`].join("\n"),
  list: (dir: string) =>
    [
      `# deploy: list`,
      "set -e",
      `cd -- ${dir}`,
      `if [ -L current ]; then printf '${marker}current=%s\\n' "$(readlink -- current)"; fi`,
      `for entry in releases/*; do if [ -d "$entry" ] && [ ! -L "$entry" ]; then printf '${marker}release=%s\\n' "\${entry#releases/}"; fi; done`,
    ].join("\n"),
  prune: (dir: string, names: string[]) =>
    [
      `# deploy: prune ${names.join(" ")}`,
      `cd -- ${dir}/releases && rm -rf -- ${names.join(" ")}`,
    ].join("\n"),
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reads `GIT_COMMIT` from a local release's `release.env`. */
async function readReleaseCommit(releaseDir: string): Promise<string | undefined> {
  const content = await readFile(join(releaseDir, "release.env"), "utf8");
  return /^GIT_COMMIT=(.*)$/m.exec(content)?.[1]?.trim();
}

/**
 * Removes old releases: keeps the newest `keepReleases` and `current`'s target. Only touches
 * directories under `releases/` whose name is a release name.
 */
export async function pruneReleases(options: {
  env: EnvironmentName;
  remote: Remote;
  keepReleases: number;
  log: (line: string) => void;
}): Promise<void> {
  if (!Number.isInteger(options.keepReleases) || options.keepReleases < 1) {
    throw new Error(
      `keepReleases must be a whole number of at least 1, not ${options.keepReleases}`,
    );
  }
  const dir = environmentDirectory(options.env);
  const listed = readMarked((await options.remote.exec(commands.list(dir))).stdout);
  const currentTarget = listed.get("current")?.at(-1);
  if (currentTarget === undefined) {
    // Without knowing what is live, removing anything could remove it.
    options.log(`Prune: skipped, could not read ${dir}/current`);
    return;
  }
  const current = releaseOfTarget(currentTarget, options.env);
  const releases = (listed.get("release") ?? [])
    .filter((name) => releaseNamePattern.test(name))
    .sort()
    .reverse();
  const doomed = releases.slice(options.keepReleases).filter((name) => name !== current);
  if (doomed.length === 0) {
    options.log(`Prune: nothing to remove (${releases.length} releases on the server)`);
    return;
  }
  await options.remote.exec(commands.prune(dir, doomed));
  options.log(`Pruned ${doomed.length} old releases: ${doomed.join(", ")}`);
}

/**
 * Deploys a release to an environment: upload, migrate, switch `current`, restart, check the
 * health, prune. A failed migration changes nothing that runs; a failed restart or health
 * check switches back to the previous release.
 */
export async function deploy(options: DeployOptions): Promise<void> {
  const { env, commit, api, remote } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const dir = environmentDirectory(env);

  if (!commitPattern.test(commit)) {
    throw new Error(
      `The commit must be 40 lowercase hexadecimal characters, not ${JSON.stringify(commit)}`,
    );
  }
  const releaseCommit = await readReleaseCommit(options.releaseDir);
  if (releaseCommit !== commit) {
    throw new Error(
      `The release's release.env names commit ${releaseCommit ?? "(none)"}, not ${commit}. Refusing to deploy a release of another commit.`,
    );
  }
  const sha7 = commit.slice(0, 7);
  const name = releaseName(now(), commit);
  const target = `releases/${name}`;
  log(`Deploying ${sha7} to ${env} as ${dir}/${target}`);

  // Look everything up before changing anything.
  const services = await findServices(api, env);
  log(
    `Found services ${String(services.api.annotation)} and ${String(services.worker.annotation)}`,
  );
  const state = readMarked((await remote.exec(commands.prepare(dir, env, name))).stdout);
  const currentTarget = state.get("current")?.at(-1);
  const previousName =
    currentTarget === undefined ? undefined : releaseOfTarget(currentTarget, env);
  const previousCommit = state.get("commit")?.at(-1)?.trim();
  let previous: { name: string; commit: string } | undefined;
  if (
    previousName !== undefined &&
    previousCommit !== undefined &&
    commitPattern.test(previousCommit)
  ) {
    previous = { name: previousName, commit: previousCommit };
    log(`Previous release: ${previous.name} (${previous.commit.slice(0, 7)})`);
  } else if (previousName !== undefined) {
    log(
      `Warning: current points at ${previousName}, which has no release.env with a commit. There is nothing to roll back to.`,
    );
  } else {
    log("No previous release: this is the first deploy");
  }

  const linkDest = previous === undefined ? undefined : `${dir}/releases/${previous.name}`;
  log(
    `Uploading to ${dir}/${target}${linkDest === undefined ? "" : `, hard-linking unchanged files from ${previous?.name}`}`,
  );
  const unchanged = `current still points at ${previous?.name ?? "nothing"} and no service was restarted`;
  /** Removes the new release after a failure before the switch; returns a note if it could not. */
  const removeNewRelease = () =>
    remote.exec(commands.remove(dir, name)).then(
      () => "",
      (removeError: unknown) => ` Could not remove ${target} either: ${errorMessage(removeError)}`,
    );
  try {
    await remote.upload(
      options.releaseDir,
      `${dir}/${target}`,
      linkDest === undefined ? {} : { linkDest },
    );
  } catch (error) {
    const cleanup = await removeNewRelease();
    throw new Error(
      `Upload of ${sha7} failed, so the deploy stopped: ${unchanged}.${cleanup}\n${errorMessage(error)}`,
    );
  }

  log("Running the database migrations of the new release");
  try {
    await remote.exec(commands.migrate(dir, name), { env: { NODEJS_VERSION: "24" } });
  } catch (error) {
    const cleanup = await removeNewRelease();
    throw new Error(
      `Migrations of ${sha7} failed, so the deploy stopped: ${unchanged}.${cleanup}\n${errorMessage(error)}`,
    );
  }
  log("Migrations are up to date");

  try {
    await remote.exec(commands.switch(dir, target));
  } catch (error) {
    // The connection may have dropped after the switch: make sure the old release stays.
    let restore = "";
    if (previous !== undefined) {
      await remote
        .exec(commands.switch(dir, `releases/${previous.name}`))
        .catch((restoreError: unknown) => {
          restore = ` Could not make sure current points at ${previous.name} either: ${errorMessage(restoreError)}`;
        });
    }
    throw new Error(
      `Switching current to ${name} failed, so the deploy stopped: no service was restarted.${restore}\n${errorMessage(error)}`,
    );
  }
  log(`Switched current from ${previous?.name ?? "nothing"} to ${name}`);

  try {
    await restartAndCheck(options, commit, "new release");
  } catch (error) {
    const failedStep =
      error instanceof HealthCheckFailure ? "its health check" : "while restarting the services";
    const reason = errorMessage(error);
    if (previous === undefined) {
      throw new Error(
        `Deploy of ${sha7} failed ${failedStep}. There is no previous release to roll back to: current stays on ${name}.\n${reason}`,
      );
    }
    log(`Deploy of ${sha7} failed ${failedStep}: ${reason}`);
    throw new Error(
      `Deploy of ${sha7} failed ${failedStep} and was rolled back to ${previous.name}.\n${reason}\n${await rollBack(options, previous)}`,
    );
  }
  log(`Health check passed: ${sha7} answers with a worker heartbeat after the restart`);

  try {
    await pruneReleases({ env, remote, keepReleases: options.keepReleases ?? 5, log });
  } catch (error) {
    // The new release is live; a failed prune only leaves disk space in use.
    log(
      `Warning: pruning old releases failed (the deploy itself succeeded): ${errorMessage(error)}`,
    );
  }
  log(`Deployed ${sha7} to ${env}`);
}

class HealthCheckFailure extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = "HealthCheckFailure";
  }
}

/**
 * Reads the services again, turns on those that are off, restarts both and waits until
 * `commit` is healthy.
 */
async function restartAndCheck(
  options: DeployOptions,
  commit: string,
  what: string,
): Promise<void> {
  const log = options.log ?? (() => {});
  const now = options.now ?? (() => new Date());
  const { services, enabled } = await enableDisabledServices(options.api, options.env);
  if (enabled.length > 0) log(`Enabled ${enabled.join(" and ")}`);
  // Before the restart: a heartbeat after this moment comes from a worker that was restarted.
  const restartedAt = now();
  await restartServices(options.api, services);
  log(
    `Restarted ${String(services.api.annotation)} and ${String(services.worker.annotation)}; waiting for the health check of the ${what} (${commit.slice(0, 7)})`,
  );
  try {
    await checkHealth({
      ...options.health,
      url: options.healthUrl,
      commit,
      heartbeatAfter: restartedAt,
    });
  } catch (error) {
    throw new HealthCheckFailure(error);
  }
}

/** Switches back to `previous`, restarts and checks its health; returns what happened. */
async function rollBack(
  options: DeployOptions,
  previous: { name: string; commit: string },
): Promise<string> {
  const log = options.log ?? (() => {});
  const dir = environmentDirectory(options.env);
  const sha7 = previous.commit.slice(0, 7);
  log(`Rolling back: switching current back to ${previous.name}`);
  try {
    await options.remote.exec(commands.switch(dir, `releases/${previous.name}`));
  } catch (error) {
    const message = `THE ROLLBACK FAILED: could not switch current back to ${previous.name}. ${options.env} may be down: check it now.\n${errorMessage(error)}`;
    log(message);
    return message;
  }
  try {
    await restartAndCheck(options, previous.commit, "previous release");
  } catch (error) {
    const message = `THE ROLLBACK TO ${sha7} ALSO FAILED its health check or restart. ${options.env} may be down: check it now.\n${errorMessage(error)}`;
    log(message);
    return message;
  }
  const message = `The rollback to ${sha7} passed its health check. The database keeps the migrations of ${options.commit.slice(0, 7)}.`;
  log(message);
  return message;
}
