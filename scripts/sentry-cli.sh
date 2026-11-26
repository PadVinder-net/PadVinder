#!/usr/bin/env bash
# Runs sentry-cli in a pinned Docker image, with this repository mounted.
#
#   scripts/sentry-cli.sh <sentry-cli arguments>
#
# Run it from inside the repository; paths in the arguments must lie inside it (relative to the
# current directory, or absolute). The repository is mounted at its own path and the command
# runs as the invoking user, so the files sentry-cli rewrites (sourcemaps inject) stay
# writable. Passes SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_URL through by name when they are
# set; their values never appear on a command line. sentry-cli does not read the repository's
# .env.
set -euo pipefail

image="getsentry/sentry-cli:3.8.2"

fail() {
  echo "sentry-cli: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
here="$(pwd -P)"

case "$here/" in
  "$root"/*) ;;
  *) fail "run it from inside the repository ($root)." ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker and try again."

# HOME: the invoking user has no home directory in the image. SENTRY_LOAD_DOTENV=0: sentry-cli
# would otherwise read .env from the working directory, the local secrets.
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$root:$root" -w "$here" \
  -e HOME=/tmp \
  -e SENTRY_LOAD_DOTENV=0 \
  -e SENTRY_NO_PROGRESS_BARS=1 \
  -e SENTRY_AUTH_TOKEN -e SENTRY_ORG -e SENTRY_URL \
  "$image" "$@"
