#!/usr/bin/env bash
# Starts sshd with a new host key, letting in the public key from AUTHORIZED_KEY.
set -euo pipefail

fail() {
  echo "entrypoint: $*" >&2
  exit 1
}

[[ -n "${AUTHORIZED_KEY:-}" ]] || fail "AUTHORIZED_KEY must hold the public key that may log in"

install -d -m 700 -o padvinder -g padvinder /home/padvinder/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/padvinder/.ssh/authorized_keys
chown padvinder:padvinder /home/padvinder/.ssh/authorized_keys
chmod 600 /home/padvinder/.ssh/authorized_keys
unset AUTHORIZED_KEY

# A fresh host key per container, so a test can only trust it by scanning this container.
ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key

exec /usr/sbin/sshd -D -e
