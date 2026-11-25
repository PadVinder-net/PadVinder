# Sourced by the workspace scripts, and from bash or zsh before a command in a worktree
# (Conductor, Orca or a plain git worktree). Exports REPO_ROOT, WORKSPACE and the ports.
#
# Workspace name: CONDUCTOR_WORKSPACE_NAME, or the worktree's directory name (Orca names
# the directory after the worktree), lowercased with every character outside [a-z0-9]
# replaced by "_".
#
# Base port: CONDUCTOR_PORT. Without it (Orca, a plain worktree) the API_PORT of this
# worktree's .env, so a second setup keeps the ports, unless another worktree has the same
# one; otherwise the first of 4100, 4110, 4120, ... that no other worktree of the repository
# has as API_PORT in its .env.
#
# Safe under `set -euo pipefail`, and leaves no helper variables behind in a shell.

if [ -n "${BASH_SOURCE[0]:-}" ]; then
  _workspace_env_script="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  # zsh syntax, kept from bash's parser: the path of the file being sourced.
  eval '_workspace_env_script="${(%):-%x}"'
else
  echo "workspace-env.sh: source this file from bash or zsh" >&2
  return 1
fi

REPO_ROOT="$(cd "$(dirname "$_workspace_env_script")/../.." && pwd)"
unset _workspace_env_script

_workspace_env_raw="${CONDUCTOR_WORKSPACE_NAME:-$(basename "$REPO_ROOT")}"
WORKSPACE="$(printf '%s' "$_workspace_env_raw" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/_/g')"
unset _workspace_env_raw

# The API_PORT line of a .env file, or nothing.
_workspace_env_api_port() {
  { sed -n 's/^API_PORT=\([0-9][0-9]*\)$/\1/p' "$1" 2>/dev/null || true; } | head -n 1
}

if [ -n "${CONDUCTOR_PORT:-}" ]; then
  BASE_PORT="$CONDUCTOR_PORT"
else
  # The API_PORT of every other worktree of this repository, separated by spaces. -ef compares
  # the directories themselves, so a symlink in one of the two paths does not matter.
  _workspace_env_taken=" $(
    { git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null || true; } |
      sed -n 's/^worktree //p' |
      while IFS= read -r _workspace_env_worktree; do
        [ "$_workspace_env_worktree" -ef "$REPO_ROOT" ] ||
          _workspace_env_api_port "$_workspace_env_worktree/.env"
      done | tr '\n' ' '
  ) "
  BASE_PORT="$(_workspace_env_api_port "$REPO_ROOT/.env")"
  # A port another worktree has too (the old fixed default, or two setups at the same moment)
  # is given up, so running setup again ends the clash.
  case "$_workspace_env_taken" in *" $BASE_PORT "*) BASE_PORT="" ;; esac
  if [ -z "$BASE_PORT" ]; then
    BASE_PORT=4100
    while case "$_workspace_env_taken" in *" $BASE_PORT "*) true ;; *) false ;; esac; do
      BASE_PORT="$((BASE_PORT + 10))"
    done
  fi
  unset _workspace_env_taken
fi
unset -f _workspace_env_api_port

API_PORT="$BASE_PORT"
MOBILE_PORT="$((BASE_PORT + 1))"
PORTAL_PORT="$((BASE_PORT + 2))"
STORYBOOK_PORT="$((BASE_PORT + 3))"
unset BASE_PORT

export REPO_ROOT WORKSPACE API_PORT MOBILE_PORT PORTAL_PORT STORYBOOK_PORT
