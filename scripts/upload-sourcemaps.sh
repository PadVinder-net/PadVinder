#!/usr/bin/env bash
# Uploads the source maps of a release (release/sourcemaps: the server bundles with their maps,
# carrying Sentry debug IDs) to the Sentry project padvinder.
#
#   scripts/upload-sourcemaps.sh <dir>
#
# Reads SENTRY_AUTH_TOKEN (an organization auth token), SENTRY_ORG (the organization's slug)
# and SENTRY_URL (default https://de.sentry.io, the EU region). Without SENTRY_AUTH_TOKEN, as in
# a local deploy, it uploads nothing and exits 0 with a warning. Uploading the same maps twice
# is harmless. The Deploy workflow runs it with continue-on-error: a failed upload never fails
# a deploy.
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

echo "upload-sourcemaps: uploading $dir to the Sentry project padvinder at $SENTRY_URL"
# Read-only: the checkout is used after this step with the deploy credentials.
SENTRY_CLI_READONLY=1 "$root/scripts/sentry-cli.sh" sourcemaps upload --org "$SENTRY_ORG" --project padvinder "$dir"
