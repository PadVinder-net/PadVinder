#!/usr/bin/env bash
# Scans the full git history for secrets with gitleaks, in a pinned Docker image.
#
#   scripts/scan-secrets.sh [<repo dir>]    default: this repository
#
# The repository is mounted read-only. Findings are redacted (--redact), so the log of a
# public workflow never shows a secret's value. Exits with gitleaks' exit code (1 = leaks).
# Allowlist false positives narrowly in .gitleaks.toml, with a comment.
set -euo pipefail

image="ghcr.io/gitleaks/gitleaks:v8.30.1"

fail() {
  echo "scan-secrets: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$(cd "${1:-$root}" 2>/dev/null && pwd)" || fail "no such directory: ${1:-}"

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker and try again."
git -C "$target" rev-parse --git-dir >/dev/null 2>&1 || fail "not a git repository: $target"

mounts=(-v "$target:/repo:ro")
# In a git worktree, .git is a file that points into the main checkout. Mount that git
# directory at the same absolute path so the pointer resolves inside the container.
if [[ -f "$target/.git" ]]; then
  common="$(cd "$target" && cd "$(git rev-parse --git-common-dir)" && pwd)"
  mounts+=(-v "$common:$common:ro")
fi

config=()
if [[ -f "$target/.gitleaks.toml" ]]; then config=(--config /repo/.gitleaks.toml); fi

echo "Scanning the git history of $target with $image"
# git refuses repositories owned by another user; mark everything safe inside the container.
docker run --rm "${mounts[@]}" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0='*' \
  "$image" git --redact --no-banner -v ${config[@]+"${config[@]}"} /repo
