#!/usr/bin/env bash
# Lints the GitHub Actions workflows with actionlint, in a pinned Docker image.
#
#   scripts/lint-workflows.sh
#
# Runs from the repository root, so actionlint also checks the shell in run: steps when
# shellcheck is available in the image. Exits 0 when there are no workflows yet.
set -euo pipefail

image="rhysd/actionlint:1.7.12"

fail() {
  echo "lint-workflows: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$root/.github/workflows" ]]; then
  echo "No .github/workflows directory; nothing to lint."
  exit 0
fi

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker and try again."

echo "Linting .github/workflows with $image"
docker run --rm -v "$root:/repo:ro" -w /repo "$image" -color
