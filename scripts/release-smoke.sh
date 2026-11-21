#!/usr/bin/env bash
# Smoke-tests padvinder:local against a fresh database on the local Compose server.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/workspace-env.sh"
cd "$REPO_ROOT"

database="padvinder_${WORKSPACE}_smoke"
psql_admin() { docker compose exec -T db psql -U padvinder -d padvinder -v ON_ERROR_STOP=1 "$@"; }

drop() { psql_admin -c "drop database if exists \"$database\" with (force)" >/dev/null; }
trap drop EXIT

drop
psql_admin -c "create database \"$database\"" >/dev/null
# Inside a container the host is host.docker.internal (Docker Desktop and CI).
"$REPO_ROOT/scripts/smoke-test-image.sh" padvinder:local \
  "postgres://padvinder:padvinder@host.docker.internal:54329/$database"
