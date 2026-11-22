#!/usr/bin/env bash
# Drops this workspace's databases. Leaves the shared container running.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/workspace-env.sh"
cd "$REPO_ROOT"

# Include leftover test databases: the template's name, "_" and exactly 8 lowercase letters, the
# rule of newTestDatabaseName and isTestDatabaseName in packages/db/src/testing.ts. A looser pattern
# would also match the databases of a workspace named "<workspace>_test_...". WORKSPACE is
# [a-z0-9_] only, so it needs no escaping.
databases="$(docker compose exec -T db psql -U padvinder -d padvinder -Atc \
  "select datname from pg_database where datname = 'padvinder_$WORKSPACE' or datname = 'padvinder_${WORKSPACE}_test' or datname ~ '^padvinder_${WORKSPACE}_test_[a-z]{8}\$' order by 1")"

for database in $databases; do
  docker compose exec -T db psql -U padvinder -d padvinder -c "drop database \"$database\" with (force)"
done

echo "Dropped the databases of workspace '$WORKSPACE'."
