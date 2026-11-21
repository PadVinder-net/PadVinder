#!/usr/bin/env bash
# Builds all apps and writes a self-contained release to release/, packed as
# padvinder-release.tar.gz. Everything a server needs is inside; it installs nothing.
#
#   scripts/build-release.sh                 refuse to build from a dirty working tree
#   scripts/build-release.sh --allow-dirty   build anyway (local testing only)
#
# Start a release from inside the release directory (variables already set in the
# environment win over both files):
#
#   node --env-file=release.env --env-file=<secrets env> api/dist/migrate.js migrations
#   node --env-file=release.env --env-file=<secrets env> api/dist/main.js
#   node --env-file=release.env --env-file=<secrets env> worker/dist/main.js
set -euo pipefail

fail() {
  echo "build-release: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="$root/release"
tarball="$root/padvinder-release.tar.gz"

allow_dirty=""
case "${1:-}" in
  "") ;;
  --allow-dirty) allow_dirty=1 ;;
  *) fail "unknown argument '$1'. Usage: scripts/build-release.sh [--allow-dirty]" ;;
esac

cd "$root"

# The release names its commit, so that commit must describe its content.
if [[ -n "$(git status --porcelain)" ]]; then
  if [[ -n "$allow_dirty" ]]; then
    echo "build-release: the working tree has uncommitted changes; building anyway (--allow-dirty)"
  else
    fail "the working tree has uncommitted changes. Commit them, or pass --allow-dirty for a local test."
  fi
fi
commit="$(git rev-parse HEAD)"

echo "build-release: removing the old release"
rm -rf "$release" "$tarball"

echo "build-release: building all apps"
pnpm build || fail "pnpm build failed."

echo "build-release: copying the API and the worker with their production dependencies"
# Copies each package's files ("files": ["dist"]) and installs only its "dependencies"; the
# @padvinder/* packages are bundled into dist. node_modules links are relative, so the
# directory can move.
pnpm --filter @padvinder/api deploy --prod "$release/api" || fail "pnpm deploy of the API failed."
pnpm --filter @padvinder/worker deploy --prod "$release/worker" ||
  fail "pnpm deploy of the worker failed."

echo "build-release: copying the mobile and portal builds and the migrations"
cp -R "$root/apps/mobile/dist" "$release/mobile"
cp -R "$root/apps/portal/dist" "$release/portal"
cp -R "$root/packages/db/drizzle" "$release/migrations"

# An absolute link would point outside the release once it is copied to a server.
absolute_link="$(find "$release" -type l -lname '/*' -print -quit)"
[[ -z "$absolute_link" ]] || fail "the release contains an absolute symlink: $absolute_link"

echo "build-release: writing release.env and release.json"
# Relative directories resolve against the working directory: the release directory.
cat >"$release/release.env" <<EOF
GIT_COMMIT=$commit
MOBILE_DIST_DIR=mobile
PORTAL_DIST_DIR=portal
EOF
# appVersion is the version the mobile build used: the environment, then .env.local and .env,
# as Vite reads them, then the version in apps/mobile/package.json; empty counts as unset.
RELEASE_ROOT="$root" RELEASE_COMMIT="$commit" node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { pathToFileURL } from "node:url";
  const root = process.env.RELEASE_ROOT;
  const { loadRootEnv } = await import(pathToFileURL(`${root}/scripts/load-env.ts`).href);
  loadRootEnv();
  const mobile = JSON.parse(readFileSync(`${root}/apps/mobile/package.json`, "utf8"));
  const release = {
    commit: process.env.RELEASE_COMMIT,
    appVersion: process.env.PADVINDER_APP_VERSION || mobile.version,
    build: process.env.PADVINDER_BUILD_NUMBER || "local",
    builtAt: new Date().toISOString(),
  };
  writeFileSync(`${root}/release/release.json`, JSON.stringify(release, null, 2) + "\n");
'

echo "build-release: packing $(basename "$tarball")"
# tar keeps pnpm's relative symlinks. COPYFILE_DISABLE keeps macOS metadata files out.
COPYFILE_DISABLE=1 tar -czf "$tarball" -C "$root" release

echo "build-release: done: release/ is $(du -sh "$release" | awk '{print $1}'), $(basename "$tarball") is $(du -h "$tarball" | awk '{print $1}')"
