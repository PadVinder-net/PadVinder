#!/usr/bin/env bash
# Builds the image padvinder:local from padvinder-release.tar.gz, as CI does.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tarball="$root/padvinder-release.tar.gz"
[[ -f "$tarball" ]] || { echo "release-image: $tarball not found. Run pnpm release:build first." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "Unpacking $tarball"
tar -xzf "$tarball" -C "$work"
# The tarball may hold the files directly or inside one directory.
context="$work"
if [[ ! -f "$context/release.env" ]]; then
  context="$(dirname "$(find "$work" -maxdepth 2 -name release.env | head -n 1)")"
fi
[[ -f "$context/release.env" ]] || { echo "release-image: no release.env in the tarball" >&2; exit 1; }

echo "Building padvinder:local"
docker build -f "$root/infra/container/Dockerfile" -t padvinder:local "$context"
