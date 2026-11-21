# Deployment and provisioning on Alwaysdata

PadVinder runs on one Alwaysdata account (Plus Small: 1 CPU, 1 GB RAM) with two environments, `production` and `staging`. This directory holds the scripts that set up the account (provisioning) and put a release live (deploy). They run from GitHub Actions, or locally by the maintainer.

The repository is public. Nowhere in it, in a workflow log or in a pull request may the account name, an IP address, a password or a key appear. This file writes the account name as `<account>`; the scripts mask it as `<account>` in their output.

Sources for Alwaysdata's behavior: the [API usage](https://help.alwaysdata.com/en/docs/development/api/usage/), [tokens](https://help.alwaysdata.com/en/docs/admin-billing/profile/tokens/), [services](https://help.alwaysdata.com/en/docs/web-hosting/services/), [PostgreSQL](https://help.alwaysdata.com/en/docs/web-hosting/databases/postgresql/), [login details](https://help.alwaysdata.com/en/docs/technical-specifications/login-details/) and [external addresses](https://help.alwaysdata.com/en/docs/web-hosting/sites/use-external-addresses/) help pages, and the API reference at `https://api.alwaysdata.com/v1/<resource>/doc/`.

## What runs where

| Thing              | Production                                         | Staging                                         |
| ------------------ | -------------------------------------------------- | ----------------------------------------------- |
| Address            | `https://padvinder.net`                            | `https://staging.padvinder.net`                 |
| Site               | `padvinder-production`, reverse proxy, Force HTTPS | `padvinder-staging`, reverse proxy, Force HTTPS |
| API service        | `padvinder-api (production)`, port 8300            | `padvinder-api (staging)`, port 8301            |
| Worker service     | `padvinder-worker (production)`                    | `padvinder-worker (staging)`                    |
| Database and user  | `<account>_production`                             | `<account>_staging`                             |
| Env file on server | `padvinder/production/.env`                        | `padvinder/staging/.env`                        |
| `ALLOWED_ORIGINS`  | `https://padvinder.net`                            | `https://staging.padvinder.net`                 |
| GitHub environment | `production` (deploys need approval)               | `staging`                                       |

Shared by both environments:

- **SSH user** `<account>_deploy`, on `ssh-<account>.alwaysdata.net` port 22. Deploys log in with it, and both environments' services run as it. Password login is off; it accepts only the deploy key.
- **Database server** `postgresql-<account>.alwaysdata.net`, port 5432. Never pgBouncer on 5433: it breaks `LISTEN`/`NOTIFY`. Each database has encoding `UTF8`, locale `C.UTF-8` and only the `postgis` extension. The migrations refuse a database with another encoding or locale, so a wrong one stops the first deploy before anything is written.
- **Services** listen on `::` (Alwaysdata services are reachable over IPv6 only, at `services-<account>.alwaysdata.net`, ports 8300–8499). Each site is a reverse proxy to its API service. The API serves the mobile app under `/app/`, the portal under `/` and itself under `/api/`. Let's Encrypt certificates for the site addresses are made and renewed by Alwaysdata on its own.
- Each service gets `NODEJS_VERSION=24` in its environment and nothing else there. Everything else comes from the env file.

A service's command, run in `padvinder/<env>/current`:

```sh
node --env-file=release.env --env-file=../../.env api/dist/main.js   # worker: worker/dist/main.js
```

The working directory `current` resolves to `releases/<name>`, so `../../.env` is `padvinder/<env>/.env`. The migrations run from the new release directory with the same `../../.env`, so services and migrations read one file, wherever the SSH user's home is.

Alwaysdata restarts a service by sending `SIGHUP`; the API and the worker shut down cleanly on it, and Alwaysdata starts them again. Services run on servers other than the SSH server, so `ps` over SSH does not show them.

### Server layout

Relative to the account home `/home/<account>`:

```
padvinder/
  <env>/
    .env                               mode 600, written only by provisioning
    releases/
      20261121T120000Z-1a2b3c4/         one directory per deploy: <UTC time>-<short commit>
    current -> releases/<name>          the live release, switched atomically
```

A release directory is the unpacked `padvinder-release.tar.gz` (see "Release" in `AGENTS.md`). Each deploy keeps the 5 newest releases plus whatever `current` points at, and removes the rest. Unchanged files are hard-linked from the previous release, so `node_modules` is stored once.

The env file holds `DATABASE_URL` (with the password), `API_HOST=::`, `API_PORT`, `ALLOWED_ORIGINS` and `LOG_LEVEL=info`. Do not edit it on the server: the next provisioning run overwrites it.

## The scripts

All three read their settings from environment variables with the same names as the GitHub secrets. Errors name missing variables, never their values. Every line they print goes through `redactForLog()`: secrets show as `***`, IP addresses as `<ip>` and the account name as `<account>`.

| Command                                                                                        | Needs                                                                            | What it does                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm infra:provision --environment <env>`                                                     | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, `DATABASE_PASSWORD`, SSH files below | Prints the plan: which resources it would create or update. Changes nothing                                                                          |
| `pnpm infra:provision --environment <env> --apply [--rotate-password]`                         | same                                                                             | Carries out the plan, then writes the env file over SSH and creates `releases/`. Never restarts anything; it says when a restart is needed           |
| `pnpm infra:provision --environment <env> --inspect`                                           | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`                                       | Read-only. Prints field names and value types of the account's resources, and the managed values of ours, to confirm the names in `src/resources.ts` |
| `pnpm infra:deploy --environment <env> --tarball padvinder-release.tar.gz --commit <full sha>` | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, SSH files below                      | Deploys one release (steps below)                                                                                                                    |
| `pnpm infra:services --environment <env> (--enable \| --disable \| --restart)`                 | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`                                       | Turns the two services of an environment on or off, or restarts them                                                                                 |
| `pnpm test:fake-host`                                                                          | Docker, a release tarball for the deploy test                                    | Tests SSH, upload and deploy against a fake host container. In CI as the `deploy-test` check                                                         |

The SSH files are `DEPLOY_SSH_KEY_FILE` (path to the private key) and `SSH_KNOWN_HOSTS_FILE` (path to a known_hosts file). In GitHub Actions, the composite action `.github/actions/alwaysdata-credentials` writes both from the `DEPLOY_SSH_KEY` and `SSH_KNOWN_HOSTS` secrets.

With `--apply`, once the SSH user exists, provisioning first reads the env file over SSH and compares its password, and only then changes anything through the API: a failing SSH login or a password that differs without `--rotate-password` stops the run with nothing changed. On the first run the SSH user is new and has no key yet, so the env file is written after the apply (and the run asks you to add the key).

Provisioning is idempotent: a second run plans `ok` for everything and writes nothing through the API. It never deletes a resource and never recreates a database. A field that can only be set at creation (database locale, encoding, extensions) and differs is reported as a `conflict`; nothing is changed then, and a human resolves it in the panel.

### What a deploy does

1. Checks that the tarball's `release.env` names the given commit, finds both services by their annotation, and reads where `current` points.
2. Uploads the release with rsync over SSH into a new `releases/<name>`, hard-linking unchanged files from the previous release.
3. Runs the migrations on the server from the new release, with the env file's `DATABASE_URL`. They may take 10 minutes at most (`timeout 600`); the error says so when they were stopped. If they fail, the new directory is removed and nothing else changes.
4. Switches `current` to the new release.
5. Reads the services again, turns disabled ones on, and restarts the API and then the worker through the Alwaysdata API. Every API request gives up after 30 seconds.
6. Polls `https://<address>/api/health` for up to 3 minutes until it answers HTTP 200 with the new commit, `status: ok` and a worker heartbeat from after the restart.
7. If the restart or the health check fails, it switches `current` back, reads the services again and turns on any that Alwaysdata switched off (it does that after repeated quick failures), restarts again and waits for the previous commit's health. The run fails either way, and the error says whether the rollback worked. Migrations are not undone: the old release runs against the migrated database, which is why migrations are additive first (two-step rule in `AGENTS.md`).
8. Removes old releases.

A deploy with a rollback takes about 7 minutes plus the time of the migrations (at most 10); the deploy jobs time out after 35, which leaves room for a full rollback.

## GitHub workflows

| Workflow (file)                           | Trigger                                                                                                                      | What it does                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Deploy (`deploy.yml`)                     | Push to `main` or to `staging/**`; by hand                                                                                   | Builds the release once (`release / build`), deploys it to staging, then for `main` only to production after approval |
| Provision (`provision.yml`)               | By hand (inputs `environment`, `apply`, `rotate-password`, `inspect`); push to `provision/staging` or `provision/production` | By hand: plan, or apply with `apply`. A push only plans and inspects, so it is always read-only                       |
| Staging services (`staging-services.yml`) | By hand (input `state`: `on` or `off`)                                                                                       | Turns the staging services on or off                                                                                  |
| CI (`ci.yml`), job `deploy-test`          | Every pull request                                                                                                           | `pnpm test:fake-host` with the release tarball of the same run                                                        |

`workflow_dispatch` ("Run workflow") works only once a workflow file is on the default branch, `main`. Until then use the push triggers: a push to `provision/<env>` plans and inspects, and a push to `staging/<name>` deploys that branch to staging.

The jobs that use secrets enter the GitHub environment `staging` or `production` and see only that environment's secrets. The release build has no environment and no secrets. Secrets go into steps through `env:` only, never into a script through `${{ }}`, and the deploy key is deleted at the end of every job.

The staging deploy, Provision and Staging services of one environment share the concurrency group `deploy-<env>`, so they never run at the same time. See "Operating notes" for the catch.

## Accounts

| Account                            | Who                              | Used for                                                                                            |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Alwaysdata profile                 | The maintainer, 2FA on           | The panel, and the API tokens (a token has the profile's rights)                                    |
| Alwaysdata account `<account>`     | (under that profile)             | Sites, services, databases, SSH users of both environments                                          |
| GitHub organization and repository | The maintainer                   | Workflows, the environments `staging` and `production`, their secrets, approving production deploys |
| DNS of `padvinder.net`             | The maintainer, at the registrar | The DNS records below (not hosted at Alwaysdata)                                                    |

## GitHub setup (once, by hand)

Settings, Environments in the repository. The step by step for the environments, with `gh` commands, is in `docs/repository-settings.md`, section 4. In short:

- [ ] Environment `staging`. Deployment branches and tags: Selected branches and tags, branch rules `main`, `staging/**` and `provision/staging`.
- [ ] Environment `production`. Required reviewers: the maintainer. "Prevent self-review" off (one maintainer would block himself). Deployment branches and tags: `main` and `provision/production`.
- [ ] In each environment, these five secrets:

| Name                 | Kind   | Staging and production                             | How to make it                                                         |
| -------------------- | ------ | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `ALWAYSDATA_API_KEY` | Secret | One token per environment (advised), or one shared | Alwaysdata panel, Profile, Tokens. Needs 2FA on the profile. See below |
| `DEPLOY_SSH_KEY`     | Secret | The same key in both                               | `ssh-keygen`, see below. The private key, the whole file               |
| `DATABASE_PASSWORD`  | Secret | Different per environment                          | `openssl rand -hex 32`                                                 |
| `ALWAYSDATA_ACCOUNT` | Secret | The same in both                                   | The account name                                                       |
| `SSH_KNOWN_HOSTS`    | Secret | The same in both                                   | `ssh-keyscan`, see below                                               |

GitHub's wildcards in deployment branch rules do not match `/`, so a staging branch is `staging/<name>` with no further slash.

The account name and the known-hosts line are secrets too, not variables: GitHub prints the `env:` values of a non-secret in a step's log, and this repository's logs are public. A secret is masked there. The known-hosts line holds `ssh-<account>.alwaysdata.net`, so it would reveal the account name. The scripts also mask the account name in their own output.

### Making each value

Run these on your own machine, not on a shared one, and in a temporary directory outside the repository: `cd "$(mktemp -d)"` first. The private key and the known-hosts file would otherwise sit in the repository as untracked files that are easy to commit by accident. Delete the directory when you are done (`rm -r` it), and keep the private key in a password manager if you want to keep it. `gh secret set` reads the value from stdin or prompt for it, so it never lands in your shell history. Replace `OWNER/REPO`.

**API token.** In the Alwaysdata panel: Profile, then Tokens. Creating a token needs two-factor authentication on the profile. Give it a name per environment (`padvinder-staging`, `padvinder-production`). Leave "allowed IPs" empty: GitHub's runners have changing addresses. The key is shown once:

```sh
gh secret set ALWAYSDATA_API_KEY --env staging --repo OWNER/REPO      # paste at the prompt
gh secret set ALWAYSDATA_API_KEY --env production --repo OWNER/REPO
```

**Deploy key.** One key pair for the SSH user `<account>_deploy`; both environments use the same SSH user, so the same private key serves both.

```sh
ssh-keygen -t ed25519 -N "" -C padvinder-deploy -f padvinder-deploy
gh secret set DEPLOY_SSH_KEY --env staging --repo OWNER/REPO < padvinder-deploy
gh secret set DEPLOY_SSH_KEY --env production --repo OWNER/REPO < padvinder-deploy
```

The public key `padvinder-deploy.pub` goes into the Alwaysdata panel (Remote access, SSH, the user `<account>_deploy`, keys) once provisioning has created that user. The API has no field for SSH keys, so this is a manual step. Then delete `padvinder-deploy`, or keep it in a password manager. For running the scripts locally, you can make your own key pair the same way and add its public key to the same user.

**Database passwords.** A different one per environment, sent straight to GitHub:

```sh
openssl rand -hex 32 | gh secret set DATABASE_PASSWORD --env staging --repo OWNER/REPO
openssl rand -hex 32 | gh secret set DATABASE_PASSWORD --env production --repo OWNER/REPO
```

GitHub cannot show a secret again. The password also stands in the env file on the server, and a lost one is replaced by rotating it (below).

**Account and known hosts.**

```sh
gh secret set ALWAYSDATA_ACCOUNT --env staging --repo OWNER/REPO      # paste the account name at the prompt
gh secret set ALWAYSDATA_ACCOUNT --env production --repo OWNER/REPO

ssh-keyscan -t ed25519 ssh-<account>.alwaysdata.net > known_hosts
ssh-keygen -lf known_hosts   # compare this fingerprint with the one the Alwaysdata panel shows
gh secret set SSH_KNOWN_HOSTS --env staging --repo OWNER/REPO < known_hosts
gh secret set SSH_KNOWN_HOSTS --env production --repo OWNER/REPO < known_hosts
```

Only store the known hosts after the fingerprint matches; with a wrong one the deploys trust the wrong server.

## First run, in this order

1. **Secrets** in both environments, as above.
2. **Plan staging, read-only.** Push the branch to `provision/staging` (`git push origin HEAD:provision/staging`). The Provision run plans and inspects; nothing changes. Check the plan, and compare the inspect output with the `UNVERIFIED` fields in `src/resources.ts`. Fix the names there if they differ, and push again.
3. **Apply staging.** Once the workflow is on `main`: Actions, Provision, Run workflow, environment `staging`, `apply` on. Until it is on `main`, run it locally instead (see "Running locally"). It creates the SSH user, the database, the database user, the site and the two services. The first apply then fails at writing the env file, because the SSH user has no key yet; the output says so.
4. **Add the deploy public key** `padvinder-deploy.pub` to the SSH user `<account>_deploy` in the panel.
5. **Apply staging again.** It finds everything `ok`, writes `padvinder/staging/.env` and creates `releases/`.
6. **Deploy to staging.** Push a branch to `staging/<name>`, or merge to `main`. The services start failing as soon as they are created (no release yet), and Alwaysdata may turn them off; the first deploy turns them on.
7. **Verify** staging: the "Verification" section below.
8. **Production:** steps 2, 3 and 5 with `production` (`provision/production` for the read-only plan). Each run waits for your approval, also a plan. The SSH user and its key already exist, so the first apply writes the env file. Then merge to `main`, check staging, and approve the production job.

## Running locally

The same commands work on your machine with the settings in the environment variables. Keep the key and the known-hosts file outside the repository. Do not pass secrets as arguments, and do not put them in `.env` files in the repository. For example, in bash or zsh:

```sh
export ALWAYSDATA_ACCOUNT='<account>'
read -rs ALWAYSDATA_API_KEY && export ALWAYSDATA_API_KEY        # paste, Enter
read -rs DATABASE_PASSWORD && export DATABASE_PASSWORD          # only for provisioning
export DEPLOY_SSH_KEY_FILE="$HOME/.ssh/padvinder-deploy" SSH_KNOWN_HOSTS_FILE="$HOME/.ssh/padvinder-known-hosts"   # outside the repository
pnpm infra:provision --environment staging
```

A local deploy needs a release built from a clean tree:

```sh
pnpm release:build
pnpm infra:deploy --environment staging --tarball padvinder-release.tar.gz --commit "$(git rev-parse HEAD)"
```

## Operating notes

- **Merging to `main`** deploys to staging, then waits for your approval for production. Approve in the run (Review deployments).
- **A branch on staging:** push it to `staging/<name>`. Every push redeploys. Delete the branch afterwards; the next merge to `main` puts `main` back on staging.
- **A branch's migrations stay on staging.** Deploying a `staging/**` branch applies its migrations to the staging database, and Drizzle tracks migrations by name. If such a migration is later changed or dropped before the merge, staging no longer matches `main`'s migrations: the changed one is never run again, and a dropped one's tables stay. When that happens, recreate the staging database (drop it in the panel and run Provision with `apply`, which creates it with the right locale) or restore it from a backup taken before the branch, then deploy `main` again.
- **A skipped production job shows green.** When you approve an older run after `main` has moved on, the production job deploys nothing; its summary has the notice "Skipped: main has moved on". The newest run deploys the newest commit.
- **Rollback.** A failed health check rolls back on its own. For a manual rollback of production: revert the change on `main` (a pull request), which deploys the reverted state; re-running an older run's production job does not work, because it skips when its commit is no longer the head of `main`. In a hurry, deploy an older commit locally (check it out, `pnpm release:build`, `pnpm infra:deploy`). Re-running an older run's staging job does put that older commit on staging, as long as its artifact exists (30 days).
- **Do not start Provision (either environment) or Staging services while a deploy of that environment is queued.** They share the concurrency group `deploy-<env>` (`deploy-staging` and `deploy-production`), and GitHub cancels a pending run when a newer one joins the group. A running job is never cancelled. If a deploy was cancelled this way, re-run it (Re-run failed jobs).
- **Provisioning never restarts the services.** When the env file changed it prints `The services must be restarted ...`. Restart with `pnpm infra:services --environment <env> --restart` locally, in the panel (Advanced, Services), or by deploying again.
- **Logs** are in `/home/<account>/admin/logs/services/` (service output: API and worker), `/home/<account>/admin/logs/http/` (requests) and `/home/<account>/admin/logs/sites/` (site starts and errors). Read them over SSH, or in the panel. The deploy steps are in the GitHub Actions run.
- **Processes and memory:** the panel, Advanced, Processes. Services run on servers separate from SSH.
- **Backups:** Alwaysdata makes a daily dump in `/home/<account>/admin/backup/<date>/postgresql/<database>.sql.zst`. A second, hourly copy elsewhere during the season is planned, not built.

### Rotating a secret

- **Database password:** set a new `DATABASE_PASSWORD` in the environment (`openssl rand -hex 32 | gh secret set ...`), then run Provision with `apply` and `rotate-password` on. Without `rotate-password` the run refuses, because the env file would then disagree with the database user. Then restart the services straight away: new database connections fail until they run with the new file.
- **API token:** make a new token in the panel, set `ALWAYSDATA_API_KEY`, delete the old token in the panel.
- **Deploy key:** make a new key pair, add the new public key to `<account>_deploy` in the panel, set `DEPLOY_SSH_KEY` in both environments, check that a deploy or a Provision apply works, then remove the old public key in the panel.
- **SSH host key** (only if Alwaysdata changes it): make `SSH_KNOWN_HOSTS` again, after checking the fingerprint.

### Turning staging off and on

Staging shares 1 GB of RAM with production. Actions, Staging services, Run workflow, `off` or `on`; locally `pnpm infra:services --environment staging --disable` or `--enable`. A deploy to staging turns it on again. Whether staging stays on by default is decided after the memory measurement in "Verification".

## DNS

DNS for `padvinder.net` is hosted at the registrar, not at Alwaysdata. These are the records as they are on 21 November 2026, as names and types only. Read the values in the registrar's DNS panel; the addresses they must point at are in the Alwaysdata panel (Advanced, Server status, the HTTP servers; see [external addresses](https://help.alwaysdata.com/en/docs/web-hosting/sites/use-external-addresses/)).

| Name                    | Type | Purpose                                   |
| ----------------------- | ---- | ----------------------------------------- |
| `padvinder.net`         | A    | Production, Alwaysdata HTTP server (IPv4) |
| `padvinder.net`         | AAAA | Production, Alwaysdata HTTP server (IPv6) |
| `padvinder.net`         | TXT  | SPF                                       |
| `padvinder.net`         | NS   | The registrar's name servers (3)          |
| `staging.padvinder.net` | A    | Staging, Alwaysdata HTTP server (IPv4)    |
| `staging.padvinder.net` | AAAA | Staging, Alwaysdata HTTP server (IPv6)    |
| `www.padvinder.net`     | A    | Not in any site's addresses yet           |
| `www.padvinder.net`     | AAAA | Not in any site's addresses yet           |

There are no MX or CAA records. `www.padvinder.net` resolves, but no PadVinder site serves it, so it has no certificate. Either add it to the production site (with a redirect) or remove the records; that is a decision for the maintainer.

Let's Encrypt only issues a certificate when the address already points at Alwaysdata, so DNS comes before the site.

## Rebuilding from scratch

### On a new Alwaysdata account

1. Make the account, its API token and the GitHub secrets for it (`ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, `SSH_KNOWN_HOSTS` change; keep or remake the others).
2. Follow "First run" up to and including the second apply, for each environment.
3. Restore the database before the first deploy (below). The deploy's migrations then find nothing to do.
4. Copy files: today there are none besides the env file and the releases, which provisioning and the deploy make again. Once photos exist, copy their storage directory too.
5. Deploy, then point DNS at the new account and wait for the certificates.

### On another host

Everything is plain Linux processes against a standard PostgreSQL; nothing here depends on Alwaysdata except the scripts in this directory. A host needs Node.js 24, PostgreSQL 18 with PostGIS 3.6 (port 5432 directly, no pooler in between), and a reverse proxy with TLS that forwards to the API port.

1. **Database.** Create it with the same locale, so sort order and indexes do not change:

   ```sh
   createdb --template=template0 --encoding=UTF8 --locale-provider=builtin --locale=C.UTF-8 padvinder
   psql -d padvinder -c 'CREATE EXTENSION postgis'
   ```

2. **Dump and restore.** From the old server (or from Alwaysdata's daily dump):

   ```sh
   pg_dump --format=custom --no-owner --no-privileges --dbname="$OLD_DATABASE_URL" --file=padvinder.dump
   pg_restore --no-owner --no-privileges --dbname="$NEW_DATABASE_URL" padvinder.dump
   ```

   An error that the `postgis` extension already exists is harmless.

3. **Release.** Unpack `padvinder-release.tar.gz`, write an env file with `DATABASE_URL`, `API_HOST`, `API_PORT`, `ALLOWED_ORIGINS` and `LOG_LEVEL` (mode 600, outside the release), then from inside `release/`:

   ```sh
   node --env-file=release.env --env-file=<env file> api/dist/migrate.js migrations
   node --env-file=release.env --env-file=<env file> api/dist/main.js      # as a service
   node --env-file=release.env --env-file=<env file> worker/dist/main.js   # as a second service
   ```

   Or run the container image from `infra/container/Dockerfile` twice, once per program. Run both under a supervisor that restarts them (systemd or similar).

4. **Files:** copy uploads once they exist. **DNS:** point the records above at the new host, and let the proxy get certificates.

## Verification

The first deploy to staging is also the test the project plan asks for. Record each result here with its date. Until then:

| What                                                                                                                                              | How to check                                                                                                                     | Status           |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| pg-boss runs the worker heartbeat every minute                                                                                                    | `/api/health` shows a fresh `worker.lastHeartbeatAt`; watch it for a few minutes                                                 | not yet verified |
| pg-boss comes back after Alwaysdata restarts the worker                                                                                           | Restart the worker (`pnpm infra:services --restart` or the panel); the heartbeat resumes                                         | not yet verified |
| The worker really restarts on a deploy (the health check cannot tell an old worker's heartbeat from a new one)                                    | Panel, Advanced, Processes: the worker's start time after a deploy; the service log shows the shutdown on `SIGHUP`               | not yet verified |
| A restart sends `SIGHUP`, and API and worker exit cleanly and start again                                                                         | Service log in `admin/logs/services/` after a restart                                                                            | not yet verified |
| An SSE connection to `/api/events` stays open for an evening without buffering by the proxy                                                       | `curl -N https://staging.padvinder.net/api/events` for an evening; heartbeat events arrive at once, not in bursts                | not yet verified |
| `LISTEN`/`NOTIFY` works on port 5432                                                                                                              | Worker heartbeats arrive over SSE (they travel by `NOTIFY`)                                                                      | not yet verified |
| PostGIS version, and whether `postgis_full_version()` still says "core procs need upgrade" on the new databases                                   | `select postgis_full_version()`; if it does, ask Alwaysdata support to run the upgrade                                           | not yet verified |
| The migrations run with the database user's rights                                                                                                | The first deploy's migration step                                                                                                | not yet verified |
| Database encoding `UTF8` and locale `C.UTF-8`                                                                                                     | `select datcollate, datctype, datlocprovider, pg_encoding_to_char(encoding) from pg_database where datname = current_database()` | not yet verified |
| The database accepts TLS connections from outside                                                                                                 | `psql "sslmode=require host=postgresql-<account>.alwaysdata.net ..."` from your machine                                          | not yet verified |
| Time zones: the server's, the database's, and that of scheduled jobs                                                                              | `date` and `echo "$TZ"` over SSH, `show timezone` in `psql`; pg-boss schedules use Europe/Amsterdam explicitly                   | not yet verified |
| Memory use of the four processes (API and worker, production and staging) fits in 1 GB                                                            | Panel, Advanced, Processes, after a day of use                                                                                   | not yet verified |
| The non-interactive shell of `<account>_deploy` prints nothing (rsync and the deploy's output depend on it)                                       | `ssh <account>_deploy@ssh-<account>.alwaysdata.net true` prints nothing; the first deploy's upload works                         | not yet verified |
| `NODEJS_VERSION=24` gives Node.js 24 in the services and over SSH                                                                                 | `NODEJS_VERSION=24 node --version` over SSH; the health check passing                                                            | not yet verified |
| The services, running as `<account>_deploy`, can read the env file (the directories are mode 700)                                                 | The first deploy's health check                                                                                                  | not yet verified |
| UNVERIFIED: `ssh.home_directory: ""` means the account root (it may come back as `"/"`, which would plan an update on every run)                  | `--inspect`, and a second plan shows `ok`                                                                                        | not yet verified |
| UNVERIFIED: `ssh.shell` value `BASH`                                                                                                              | `--inspect`                                                                                                                      | not yet verified |
| UNVERIFIED: database fields `encoding`, `locale`, `extensions` (names and formats; create-only)                                                   | `--inspect`, and the SQL check above                                                                                             | not yet verified |
| UNVERIFIED: `database/user.permissions` keys are database names, not ids                                                                          | `--inspect`                                                                                                                      | not yet verified |
| UNVERIFIED: the reverse proxy's target field `remote_url`, and that the proxy reaches `http://services-<account>.alwaysdata.net:<port>` over IPv6 | `--inspect`; `https://staging.padvinder.net/api/health` answers                                                                  | not yet verified |
| UNVERIFIED: site `addresses` order                                                                                                                | A second plan shows `ok`                                                                                                         | not yet verified |
| UNVERIFIED: service `environment` format (`NAME=value`, space-separated)                                                                          | `--inspect`                                                                                                                      | not yet verified |
| UNVERIFIED: a listed service reports `ssh_user` as an id                                                                                          | `--inspect`                                                                                                                      | not yet verified |
| UNVERIFIED: the service on/off field `is_disabled`                                                                                                | Staging services off and on; the panel shows the change                                                                          | not yet verified |
| The status codes of the API's `PATCH` and `restart` (the fake answers 204)                                                                        | The first apply and deploy succeed                                                                                               | not yet verified |

When a name differs, change it in `src/resources.ts` only, and the fake in `src/testing/fake-api.ts` if its answers differ.
