# Sourced by the workspace scripts. Exports WORKSPACE and the ports.
# Workspace name: CONDUCTOR_WORKSPACE_NAME, or the repository directory name,
# lowercased with every character outside [a-z0-9] replaced by "_".

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

_raw_workspace="${CONDUCTOR_WORKSPACE_NAME:-$(basename "$REPO_ROOT")}"
WORKSPACE="$(printf '%s' "$_raw_workspace" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')"
unset _raw_workspace

BASE_PORT="${CONDUCTOR_PORT:-4100}"
API_PORT="$BASE_PORT"
MOBILE_PORT="$((BASE_PORT + 1))"
PORTAL_PORT="$((BASE_PORT + 2))"
STORYBOOK_PORT="$((BASE_PORT + 3))"

export REPO_ROOT WORKSPACE API_PORT MOBILE_PORT PORTAL_PORT STORYBOOK_PORT
