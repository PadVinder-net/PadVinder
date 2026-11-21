#!/usr/bin/env bash
# Smoke-tests a release image: migrates a database, starts the worker and the API, and
# checks health and the static apps.
#
#   scripts/smoke-test-image.sh <image> <database-url>
#
# The database URL must work from inside a container (host.docker.internal on CI and
# Docker Desktop). Containers carry the label padvinder-smoke and are removed on exit.
set -euo pipefail

fail() {
  echo "smoke-test-image: $*" >&2
  exit 1
}

[[ $# -eq 2 ]] || fail "usage: scripts/smoke-test-image.sh <image> <database-url>"
image="$1"
database_url="$2"

label="padvinder-smoke"
run_id="$$-$(date +%s)"
containers=("")
common=(--label "$label" --add-host=host.docker.internal:host-gateway -e "DATABASE_URL=$database_url")

dump_logs() {
  local c
  for c in "${containers[@]}"; do
    [[ -n "$c" ]] || continue
    echo "----- logs of $c -----" >&2
    docker logs "$c" >&2 2>&1 || true
  done
}

cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then dump_logs; fi
  local c
  for c in "${containers[@]}"; do [[ -z "$c" ]] || docker rm -f "$c" >/dev/null 2>&1 || true; done
  exit "$code"
}
trap cleanup EXIT

commit="$(docker run --rm "$image" cat release.env | sed -n 's/^GIT_COMMIT=//p')"
[[ -n "$commit" ]] || fail "no GIT_COMMIT in release.env of $image"

echo "Migrating"
migrate="padvinder-smoke-migrate-$run_id"
containers+=("$migrate")
docker run --name "$migrate" "${common[@]}" "$image" \
  node --env-file=release.env api/dist/migrate.js migrations \
  || fail "migrate failed"

echo "Starting the worker and the API"
worker="padvinder-smoke-worker-$run_id"
containers+=("$worker")
docker run -d --name "$worker" "${common[@]}" "$image" \
  node --env-file=release.env worker/dist/main.js >/dev/null

api="padvinder-smoke-api-$run_id"
containers+=("$api")
# The allowed origin must name the published port, so pick a free port up front.
port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
docker run -d --name "$api" "${common[@]}" -e "ALLOWED_ORIGINS=http://localhost:$port" \
  -p "127.0.0.1:$port:8080" "$image" >/dev/null
base="http://127.0.0.1:$port"

echo "Waiting for $base/api/health"
body=""
for _ in $(seq 1 60); do
  code="$(curl -s --max-time 3 -o /tmp/smoke-health.$$ -w '%{http_code}' "$base/api/health" || true)"
  if [[ "$code" == "200" ]]; then
    body="$(cat /tmp/smoke-health.$$)"
    break
  fi
  sleep 1
done
rm -f /tmp/smoke-health.$$
[[ -n "$body" ]] || fail "/api/health did not return 200 within 60 s (last status: ${code:-none})"

echo "Health: $body"
[[ "$(jq -r .status <<<"$body")" == "ok" ]] || fail "health status is not ok"
[[ "$(jq -r .commit <<<"$body")" == "$commit" ]] || fail "health commit differs from $commit"
[[ "$(jq -r '.worker.lastHeartbeatAt // empty' <<<"$body")" != "" ]] || fail "no worker heartbeat"

check() { # path, expected content type prefix (optional), extra curl args
  local path="$1" type="$2"
  shift 2
  local out
  out="$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{content_type}' "$@" "$base$path")"
  [[ "${out%% *}" == "200" ]] || fail "GET $path returned ${out%% *}"
  [[ -z "$type" || "${out#* }" == "$type"* ]] || fail "GET $path has content type '${out#* }'"
}
check /app/ text/html
check / text/html -H "Accept: text/html"
check /app/manifest.webmanifest ""

echo "Smoke test passed: $commit"
