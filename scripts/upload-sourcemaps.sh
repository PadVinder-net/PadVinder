#!/usr/bin/env bash
# Uploads the source maps of a release (release/sourcemaps: the server bundles and the
# browser bundles with their maps, carrying Sentry debug IDs) to the Sentry projects:
# the server bundles (api, worker) to padvinder-server, the browser bundles (mobile,
# portal) to padvinder-browser.
#
#   scripts/upload-sourcemaps.sh <dir>
#
# Reads SENTRY_AUTH_TOKEN (an organization auth token), SENTRY_ORG (the organization's slug, a
# secret like the token) and SENTRY_URL (default https://de.sentry.io, the EU region). Without
# SENTRY_AUTH_TOKEN, as in a local deploy, it uploads nothing and exits 0 with a warning.
# Uploading the same maps twice is harmless. The Deploy workflow runs it with continue-on-error:
# a failed upload never fails a deploy.
set -euo pipefail

warn() {
  # An annotation in a GitHub Actions run; a plain line elsewhere.
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::warning::upload-sourcemaps: $*"
  else
    echo "upload-sourcemaps: warning: $*" >&2
  fi
}

fail() {
  echo "upload-sourcemaps: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ $# -eq 1 ]] || fail "usage: scripts/upload-sourcemaps.sh <dir>"
dir="$1"

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  warn "SENTRY_AUTH_TOKEN is not set; uploading no source maps."
  exit 0
fi
[[ -n "${SENTRY_ORG:-}" ]] || fail "SENTRY_ORG is not set (the slug of the Sentry organization)."
[[ -d "$dir" ]] || fail "no such directory: $dir"

export SENTRY_URL="${SENTRY_URL:-https://de.sentry.io}"

# Read-only: the checkout is used after this step with the deploy credentials.
# The organization reaches sentry-cli through SENTRY_ORG only, never on its command line: it is a
# secret, and the logs of the Deploy workflow are public.
upload_to() {
  local project="$1"
  shift
  local dirs=()
  local name
  for name in "$@"; do
    if [[ -d "$dir/$name" ]]; then
      dirs+=("$dir/$name")
    else
      warn "no source maps in $dir/$name; skipping it."
    fi
  done
  [[ ${#dirs[@]} -gt 0 ]] || return 0
  echo "upload-sourcemaps: uploading ${dirs[*]} to the Sentry project $project at $SENTRY_URL"
  SENTRY_CLI_READONLY=1 "$root/scripts/sentry-cli.sh" sourcemaps upload --project "$project" "${dirs[@]}"
}

# Both projects are tried even when the first upload fails; the exit status says if one failed.
status=0
upload_to padvinder-server api worker || status=1
upload_to padvinder-browser mobile portal || status=1
exit "$status"
