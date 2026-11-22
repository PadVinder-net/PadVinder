# A stand-in for the Alwaysdata SSH host in tests (see src/testing/fake-host.ts): Debian 12
# with OpenSSH, rsync, Node.js 24 and psql. One user, `padvinder`, stands in for the account's
# main SSH user, which is named like the account and lives in `/home/<account>`. It logs in
# with the key in the AUTHORIZED_KEY environment variable; passwords are off.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-server rsync postgresql-client procps \
  && rm -rf /var/lib/apt/lists/* \
  && rm -f /etc/ssh/ssh_host_* \
  && mkdir -p /run/sshd \
  && useradd --create-home --shell /bin/bash padvinder \
  && usermod --password '*' padvinder \
  && printf '%s\n' \
    'HostKey /etc/ssh/ssh_host_ed25519_key' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PermitRootLogin no' \
    'AllowUsers padvinder' \
    > /etc/ssh/sshd_config.d/padvinder.conf

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
