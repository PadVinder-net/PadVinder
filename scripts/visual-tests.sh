#!/usr/bin/env bash
# Runs the Storybook visual tests (pnpm test:visual) in the Playwright Docker image, the
# same image CI uses, so screenshots match the references whatever machine you are on.
#
#   scripts/visual-tests.sh            compare with the reference screenshots
#   scripts/visual-tests.sh --update   write new reference screenshots; review and commit them
#
# The repository is mounted read-only and copied inside the container, so the container's
# Linux node_modules never mix with yours. Only the reference screenshots and the images of
# failed comparisons (packages/ui/.vitest) are written back.
set -euo pipefail

# Keep the tag equal to the @playwright/test version; scripts/playwright-version.test.ts checks it.
image="mcr.microsoft.com/playwright:v1.65.1-noble"
pnpm_version="12.21.0"
screenshots="packages/ui/src/__screenshots__"
attachments="packages/ui/.vitest"

fail() {
  echo "visual-tests: $*" >&2
  exit 1
}

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

update=""
case "${1:-}" in
  "") ;;
  --update) update="--update" ;;
  *) fail "unknown argument '$1'. Usage: scripts/visual-tests.sh [--update]" ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker info >/dev/null 2>&1 || fail "Docker is not running. Start Docker and try again."

mkdir -p "$root/$screenshots"
# Images of failed comparisons from an earlier run would only confuse.
rm -rf "${root:?}/$attachments"
mkdir -p "$root/$attachments"

if [[ -n "$update" ]]; then
  echo "Updating the reference screenshots in $screenshots with $image"
else
  echo "Comparing with the reference screenshots in $screenshots with $image"
fi

# Runs inside the container. Files it writes to the mounted directories are handed to the
# host user at the end, also on failure, because the container runs as root.
container_script='
set -euo pipefail
trap "chown -R \"$HOST_UID:$HOST_GID\" /work/$SCREENSHOTS /work/$ATTACHMENTS" EXIT

echo "Copying the repository to /work"
tar -C /src -cf - \
  --exclude=./.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=".env*" \
  --exclude=./release \
  --exclude="./$SCREENSHOTS" \
  --exclude="./$ATTACHMENTS" \
  . | tar -C /work -xf -

echo "Installing pnpm $PNPM_VERSION"
npm install --global --silent "pnpm@$PNPM_VERSION"

cd /work
echo "Installing dependencies"
pnpm install --frozen-lockfile --store-dir /pnpm-store

echo "Running pnpm test:visual $UPDATE"
pnpm test:visual $UPDATE
'

docker run --rm --init \
  --volume "$root:/src:ro" \
  --volume "padvinder-pnpm-store:/pnpm-store" \
  --volume "$root/$screenshots:/work/$screenshots" \
  --volume "$root/$attachments:/work/$attachments" \
  --env "SCREENSHOTS=$screenshots" \
  --env "ATTACHMENTS=$attachments" \
  --env "PNPM_VERSION=$pnpm_version" \
  --env "UPDATE=$update" \
  --env "HOST_UID=$(id -u)" \
  --env "HOST_GID=$(id -g)" \
  "$image" bash -c "$container_script" ||
  fail "the visual tests failed. Images of failed comparisons are in $attachments."
