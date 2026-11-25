# Deployment and provisioning on Alwaysdata

PadVinder runs on one Alwaysdata account (Plus Small: 1 CPU, 1 GB RAM) with two environments, `production` and `staging`. This directory holds the scripts that set up the account (provisioning) and put a release live (deploy). They run from GitHub Actions, or locally by the maintainer.

The repository is public. Nowhere in it, in a workflow log or in a pull request may the account name, an IP address, a password or a key appear. This file writes the account name as `<account>`; the scripts mask it as `<account>` in their output.

Sources for Alwaysdata's behavior: the [API usage](https://help.alwaysdata.com/en/docs/development/api/usage/), [tokens](https://help.alwaysdata.com/en/docs/admin-billing/profile/tokens/), [services](https://help.alwaysdata.com/en/docs/web-hosting/services/), [PostgreSQL](https://help.alwaysdata.com/en/docs/web-hosting/databases/postgresql/), [login details](https://help.alwaysdata.com/en/docs/technical-specifications/login-details/) and [external addresses](https://help.alwaysdata.com/en/docs/web-hosting/sites/use-external-addresses/) help pages, and the API reference at `https://api.alwaysdata.com/v1/<resource>/doc/`.

## What runs where

| Thing              | Production                                  | Staging                                             |
| ------------------ | ------------------------------------------- | --------------------------------------------------- |
| Address            | `https://padvinder.net`                     | `https://staging.padvinder.net`                     |
| Site               | `padvinder.net`, reverse proxy, Force HTTPS | `staging.padvinder.net`, reverse proxy, Force HTTPS |
| API service        | `padvinder-api (production)`, port 8300     | `padvinder-api (staging)`, port 8301                |
| Worker service     | `padvinder-worker (production)`             | `padvinder-worker (staging)`                        |
| Database and user  | `<account>_production`                      | `<account>_staging`                                 |
| Env file on server | `padvinder/production/.env`                 | `padvinder/staging/.env`                            |
| `ALLOWED_ORIGINS`  | `https://padvinder.net`                     | `https://staging.padvinder.net`                     |
| GitHub environment | `production` (deploys need approval)        | `staging`                                           |

Shared by both environments:

- **SSH user:** the account's main SSH user, named like the account (`<account>`), on `ssh-<account>.alwaysdata.net` port 22. Alwaysdata creates it with the account. Provisioning and deploys log in with it, so it owns the releases, `current` and the env files, like everything else on the account, and the services run as it: each service names it in `ssh_user`, which the API requires. Provisioning creates no SSH user and does not change this one: it only looks up its id (the SSH user whose name equals the account name), and stops before any change when there is none or more than one. Its keys, and whether it accepts a password, are set in the panel. Why no separate deploy user: Alwaysdata SSH users are not chrooted, so every SSH user reaches the whole account and a second one isolates nothing, and several SSH users cause file-rights problems ([SSH troubleshooting, rights](https://help.alwaysdata.com/en/docs/web-hosting/remote-access/ssh/troubleshooting/#rights)).
- **Database server** `postgresql-<account>.alwaysdata.net`, port 5432. Never pgBouncer on 5433: it breaks `LISTEN`/`NOTIFY`. Each database has encoding `UTF8`, locale `C.UTF-8` and only the `postgis` extension. The migrations refuse a database with another encoding or locale, so a wrong one stops the first deploy before anything is written.
- **Services** listen on `::` (Alwaysdata services are reachable over IPv6 only, at `services-<account>.alwaysdata.net`, ports 8300–8499). Each site is a reverse proxy to its API service. The API serves the mobile app under `/app/`, the portal under `/` and itself under `/api/`. Let's Encrypt certificates for the site addresses are made and renewed by Alwaysdata on its own.
- Each service gets `NODEJS_VERSION=24` in its environment and nothing else there. Everything else comes from the env file.

A service's command, run in `padvinder/<env>/current`:

```sh
node --env-file=release.env --env-file=../../.env api/dist/main.js   # worker: worker/dist/main.js
```

The working directory `current` resolves to `releases/<name>`, so `../../.env` is `padvinder/<env>/.env`. The migrations run from the new release directory with the same `../../.env`, so services and migrations read one file, wherever the account's home is.

Alwaysdata restarts a service by sending `SIGTERM` and starting it again once it has exited (confirmed 22 November 2026; its documentation suggests `SIGHUP`). The API and the worker shut down cleanly on it, within about a second, and are back within about two. They also handle `SIGHUP`. Services run on servers other than the SSH server, so `ps` over SSH does not show them.

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

The env file holds `DATABASE_URL` (with the password), `API_HOST=::`, `API_PORT`, `ALLOWED_ORIGINS`, `LOG_LEVEL=info`, and what login needs: `PUBLIC_ORIGIN` (the address in the table above), `AUTH_SECRET`, `SMTP_HOST` (`smtp-<account>.alwaysdata.net`), `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` (`PadVinder <noreply@padvinder.net>`, see "Mail"). `LOGIN_RATE_LIMITS` is never in it: the API's default is on, and it refuses `off` on an HTTPS origin. Do not edit the file on the server: the next provisioning run overwrites it.

## The scripts

All three read their settings from environment variables with the same names as the GitHub secrets. Errors name missing variables, never their values. Provisioning (plan and apply, not `--inspect`) needs every secret of the env file and stops before it reads or changes anything when one is missing, so it never writes an env file the API refuses. It also refuses an `AUTH_SECRET` shorter than 32 characters, and a value of `AUTH_SECRET`, `SMTP_USER` or `SMTP_PASSWORD` with a space, a quote, a backtick, a backslash, `#` or a character outside printable ASCII: the env file holds them unquoted, and Node's `--env-file` would cut or change such a value. Every line they print goes through `redactForLog()`: secrets show as `***`, IP addresses as `<ip>` and the account name as `<account>`.

| Command                                                                                        | Needs                                                                                                                   | What it does                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm infra:provision --environment <env>`                                                     | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, `DATABASE_PASSWORD`, `AUTH_SECRET`, `SMTP_USER`, `SMTP_PASSWORD`, SSH below | Prints the plan: which resources it would create or update. Changes nothing                                                                                    |
| `pnpm infra:provision --environment <env> --apply [--rotate-password]`                         | same                                                                                                                    | Reads the env file over SSH, carries out the plan, then writes the env file and creates `releases/`. Never restarts anything; it says when a restart is needed |
| `pnpm infra:provision --environment <env> --inspect`                                           | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`                                                                              | Read-only. Prints field names and value types of the account's resources, and the managed values of ours, to confirm the names in `src/resources.ts`           |
| `pnpm infra:deploy --environment <env> --tarball padvinder-release.tar.gz --commit <full sha>` | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, SSH below                                                                   | Deploys one release (steps below)                                                                                                                              |
| `pnpm infra:services --environment <env> (--enable \| --disable \| --restart)`                 | `ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`                                                                              | Turns the two services of an environment on or off, or restarts them                                                                                           |
| `pnpm test:fake-host`                                                                          | Docker, a release tarball for the deploy test                                                                           | Tests SSH, upload and deploy against a fake host container. In CI as the job `deploy-test`                                                                     |

SSH needs `SSH_KNOWN_HOSTS_FILE` (path to a known_hosts file) and the private key, from one of two places:

- `DEPLOY_SSH_AGENT_SOCK`: the socket of an ssh-agent that holds the key. This is how CI does it: the composite action `.github/actions/alwaysdata-credentials` starts a dedicated agent (without the secrets in its environment), loads the `DEPLOY_SSH_KEY` secret into it over stdin, and writes the `SSH_KNOWN_HOSTS` secret to a file. The key never touches the runner's disk. The action exports `DEPLOY_SSH_AGENT_SOCK` and `DEPLOY_SSH_AGENT_PID`, not `SSH_AUTH_SOCK`, and the final step of each job stops the agent (`ssh-agent -k`).
- `DEPLOY_SSH_KEY_FILE`: path to the private key file, for local runs. When it is set, it wins over `DEPLOY_SSH_AGENT_SOCK`.

The scripts never read `SSH_AUTH_SOCK`, so a local run does not use your personal agent unless you say so.

ssh offers only that key file, or only the keys of that agent (`IdentityAgent=<socket>` with `IdentityFile=none`), never the default keys in `~/.ssh`, and reads no `~/.ssh/config`. With an agent it offers every key the agent holds: the one in CI holds only the deploy key, but a personal agent may hold many, and a server stops after a few wrong ones.

With `--apply`, provisioning first reads the env file over SSH and compares its password, and only then changes anything through the API: a failing SSH login or a password that differs without `--rotate-password` stops the run with nothing changed. This holds on the first run too, when there is no env file yet: the main SSH user exists from the start, so the deploy key only has to be on it before the first apply.

Provisioning is idempotent: a second run plans `ok` for everything and writes nothing through the API. It never deletes a resource and never recreates a database. Provisioning finds a site by its first address, not by name: the API does not keep the name sent on create. A database user gets `FULL` on its own database and `NONE` on every other database the API lists, so the staging user cannot reach production's database. A field that can only be set at creation (database locale, extensions) and differs is reported as a `conflict`; nothing is changed then, and a human resolves it in the panel.

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

| Workflow (file)                           | Trigger                                                                                     | What it does                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Deploy (`deploy.yml`)                     | Push to `main`, unless it changes only docs and tests (`paths-ignore`); by hand from `main` | Builds the release once (`release / build`), deploys it to staging, then to production after approval |
| Provision (`provision.yml`)               | By hand from `main` (inputs `environment`, `apply`, `rotate-password`, `inspect`)           | Plans, or applies with `apply`; with `inspect` also prints the account's field names                  |
| Staging services (`staging-services.yml`) | By hand (input `state`: `on` or `off`)                                                      | Turns the staging services on or off                                                                  |
| CI, job `deploy-test` (`ci.yml`)          | Pull requests that touch the deploy path (`scripts/lib/ci-jobs.ts`); skipped otherwise      | `pnpm test:fake-host` with CI's release tarball, and the credentials action with a throwaway key      |

Only `main` reaches the environments: both GitHub environments allow the branch `main` only, and the workflows run there only (a Deploy run by hand from another branch skips its deploy jobs). `workflow_dispatch` ("Run workflow") works only once a workflow file is on `main`.

The jobs that use secrets enter the GitHub environment `staging` or `production` and see only that environment's secrets. The release build has no environment and no secrets. Secrets go into steps through `env:` only, never into a script through `${{ }}`, and the ssh-agent that holds the deploy key is stopped at the end of every job.

The staging deploy, Provision and Staging services of one environment share the concurrency group `deploy-<env>`, so they never run at the same time. See "Operating notes" for the catch.

## Accounts

| Account                            | Who                              | Used for                                                                                            |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Alwaysdata profile                 | The maintainer, 2FA on           | The panel, and the API tokens (a token has the profile's rights)                                    |
| Alwaysdata account `<account>`     | (under that profile)             | Sites, services, databases of both environments; its main SSH user for provisioning and deploys     |
| GitHub organization and repository | The maintainer                   | Workflows, the environments `staging` and `production`, their secrets, approving production deploys |
| Mailbox `noreply@padvinder.net`    | (on the account `<account>`)     | The sender of the login codes, for both environments (see "Mail")                                   |
| DNS of `padvinder.net`             | The maintainer, at the registrar | The DNS records below (not hosted at Alwaysdata)                                                    |

## GitHub setup (once, by hand)

Settings, Environments in the repository. The step by step for the environments, with `gh` commands, is in `docs/repository-settings.md`, section 4. In short:

- [ ] Environment `staging`. Deployment branches and tags: Selected branches and tags, the branch rule `main` only.
- [ ] Environment `production`. Required reviewers: the maintainer. "Prevent self-review" off (one maintainer would block himself). Deployment branches and tags: `main` only.
- [ ] In each environment, these eight secrets:

| Name                 | Kind   | Staging and production                             | How to make it                                                          |
| -------------------- | ------ | -------------------------------------------------- | ----------------------------------------------------------------------- |
| `ALWAYSDATA_API_KEY` | Secret | One token per environment (advised), or one shared | Alwaysdata panel, Profile, Tokens. Needs 2FA on the profile. See below  |
| `DEPLOY_SSH_KEY`     | Secret | The same key in both                               | `ssh-keygen`, see below. The private key, the whole file, no passphrase |
| `DATABASE_PASSWORD`  | Secret | Different per environment                          | `openssl rand -hex 32`                                                  |
| `ALWAYSDATA_ACCOUNT` | Secret | The same in both                                   | The account name                                                        |
| `SSH_KNOWN_HOSTS`    | Secret | The same in both                                   | `ssh-keyscan`, see below                                                |
| `AUTH_SECRET`        | Secret | Different per environment                          | `openssl rand -hex 32`. Better Auth signs sessions with it              |
| `SMTP_USER`          | Secret | The same in both                                   | The mailbox address, `noreply@padvinder.net` (see "Mail")               |
| `SMTP_PASSWORD`      | Secret | The same in both                                   | The mailbox's password, `openssl rand -hex 32` (see "Mail")             |

**Why `main` only, also for staging.** Both environments live on one Alwaysdata account, and there every SSH user and every API token reaches everything: the staging token can read and change production, and the deploy key logs in as the account's main user, which runs and owns both. Whoever can run code in the `staging` environment can therefore read production's secrets and data. So the account is the security boundary, not the environment, and staging is treated as production-sensitive: only reviewed code on `main` may hold the deploy credentials. A branch cannot be tried on staging from GitHub; merge it, or the maintainer deploys it locally with the CLI (see "Running locally").

The account name and the known-hosts line are secrets too, not variables: GitHub prints the `env:` values of a non-secret in a step's log, and this repository's logs are public. A secret is masked there. The known-hosts line holds `ssh-<account>.alwaysdata.net`, so it would reveal the account name. The scripts also mask the account name in their own output.

### Making each value

Run these on your own machine, not on a shared one, and in a temporary directory outside the repository: `cd "$(mktemp -d)"` first. The private key and the known-hosts file would otherwise sit in the repository as untracked files that are easy to commit by accident. Delete the directory when you are done (`rm -r` it), and keep the private key in a password manager if you want to keep it. `gh secret set` reads the value from stdin or prompt for it, so it never lands in your shell history.

**API token.** In the Alwaysdata panel: Profile, then Tokens. Creating a token needs two-factor authentication on the profile. Give it a name per environment (`padvinder-staging`, `padvinder-production`). Leave "allowed IPs" empty: GitHub's runners have changing addresses. The key is shown once:

```sh
gh secret set ALWAYSDATA_API_KEY --env staging --repo PadVinder-net/PadVinder      # paste at the prompt
gh secret set ALWAYSDATA_API_KEY --env production --repo PadVinder-net/PadVinder
```

**Deploy key.** One key pair for the account's main SSH user `<account>`; both environments log in as that user, so the same private key serves both.

```sh
ssh-keygen -t ed25519 -N "" -C padvinder-deploy -f padvinder-deploy
gh secret set DEPLOY_SSH_KEY --env staging --repo PadVinder-net/PadVinder < padvinder-deploy
gh secret set DEPLOY_SSH_KEY --env production --repo PadVinder-net/PadVinder < padvinder-deploy
```

The public key `padvinder-deploy.pub` goes into the Alwaysdata panel (Remote access, SSH, the user `<account>`, keys), before the first apply. That user exists since the account was made; provisioning creates no SSH user. The API has no field for SSH keys, so this is a manual step. Then delete `padvinder-deploy`, or keep it in a password manager. For running the scripts locally, you can make your own key pair the same way and add its public key to the same user.

**Database passwords.** A different one per environment, sent straight to GitHub:

```sh
openssl rand -hex 32 | gh secret set DATABASE_PASSWORD --env staging --repo PadVinder-net/PadVinder
openssl rand -hex 32 | gh secret set DATABASE_PASSWORD --env production --repo PadVinder-net/PadVinder
```

GitHub cannot show a secret again. The password also stands in the env file on the server, and a lost one is replaced by rotating it (below).

**Login secret.** A different one per environment, like the database passwords:

```sh
openssl rand -hex 32 | gh secret set AUTH_SECRET --env staging --repo PadVinder-net/PadVinder
openssl rand -hex 32 | gh secret set AUTH_SECRET --env production --repo PadVinder-net/PadVinder
```

**Mailbox.** Make the password first, then the mailbox with it (see "Mail"), then the secrets. Both environments send from the same mailbox:

```sh
openssl rand -hex 32 > smtp-password      # in the temporary directory; paste it into the panel
gh secret set SMTP_PASSWORD --env staging --repo PadVinder-net/PadVinder < smtp-password
gh secret set SMTP_PASSWORD --env production --repo PadVinder-net/PadVinder < smtp-password
printf noreply@padvinder.net | gh secret set SMTP_USER --env staging --repo PadVinder-net/PadVinder
printf noreply@padvinder.net | gh secret set SMTP_USER --env production --repo PadVinder-net/PadVinder
```

The mailbox address is no real secret (it is the sender of every mail), but another mail service would give a login that is one, so it is a secret from the start.

**Account and known hosts.**

```sh
gh secret set ALWAYSDATA_ACCOUNT --env staging --repo PadVinder-net/PadVinder      # paste the account name at the prompt
gh secret set ALWAYSDATA_ACCOUNT --env production --repo PadVinder-net/PadVinder

ssh-keyscan -t ed25519 ssh-<account>.alwaysdata.net > known_hosts
ssh-keygen -lf known_hosts   # compare this fingerprint with the one the Alwaysdata panel shows
gh secret set SSH_KNOWN_HOSTS --env staging --repo PadVinder-net/PadVinder < known_hosts
gh secret set SSH_KNOWN_HOSTS --env production --repo PadVinder-net/PadVinder < known_hosts
```

Only store the known hosts after the fingerprint matches; with a wrong one the deploys trust the wrong server.

## Mail

The API sends the login codes over SMTP. On Alwaysdata it uses Alwaysdata's own SMTP server, logged in as a mailbox on the account: no extra service and no extra cost (decided in `docs/superpowers/specs/2026-11-21-accounts-and-access-design.md`, "Mail in production and staging"). Alwaysdata documents no sending limits and no delivery logs, so delivery is a check (see "Verification"); if mail lands in spam or does not arrive, move to a transactional mail service.

| Setting               | Value                                         | Where it comes from                                                                                                                                                  |
| --------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_HOST`           | `smtp-<account>.alwaysdata.net`               | `smtpHost()` in `src/environments.ts`, from the account name                                                                                                         |
| `SMTP_PORT`           | `465`, TLS from the first byte                | `smtpPort` in `src/environments.ts`. The only port Alwaysdata's login details page lists                                                                             |
| `SMTP_USER`           | `noreply@padvinder.net`                       | Secret `SMTP_USER`. Alwaysdata's SMTP login is the full mailbox address                                                                                              |
| `SMTP_PASSWORD`       | The mailbox's password                        | Secret `SMTP_PASSWORD`                                                                                                                                               |
| `MAIL_FROM`           | `PadVinder <noreply@padvinder.net>`           | `mailFrom` in `src/environments.ts`. Must be the mailbox `SMTP_USER` logs in as                                                                                      |
| `MAIL_SUBJECT_PREFIX` | `[STAGING]` on staging, not set on production | `mailSubjectPrefix` in `src/environments.ts`. The API puts it and a space before the subject of every mail, so a mail from staging cannot be mistaken for a real one |

**The mailbox name is fixed by `mailFrom`:** the mailbox must be `noreply@padvinder.net`, and `SMTP_USER` must be that address. Alwaysdata's SMTP server sends as the mailbox it logs in as, so while the SMTP host is Alwaysdata's, provisioning refuses an `SMTP_USER` that differs from the address in `mailFrom` (the error names the variable, not the values). Another mailbox name means changing `mailFrom` in a pull request first.

The API requires TLS whenever it logs in (port 465: TLS at once; any other port: STARTTLS or nothing is sent), so the password never travels in plain text. Staging and production send from the same mailbox, with the same sender; a code only works in the environment that sent it.

**Make the mailbox, once, before the first Provision with login.** In the panel:

1. Domains: check that `padvinder.net` is listed (the sites use it, so it probably is). If it is not, add it as a domain whose DNS stays elsewhere: do not move the name servers to Alwaysdata; DNS stays at the registrar (see "DNS").
2. Emails, Addresses, Add: domain `padvinder.net`, local part `noreply`, password the one made for `SMTP_PASSWORD` (see "Mailbox" under "Making each value"). Leave the other settings at their defaults; set a small quota if you like, nothing needs to stay in it.
3. Domains, `padvinder.net`, DNS records: this lists the SPF, DKIM and DMARC records Alwaysdata wants. Copy them to the registrar (see "DNS"). Mail sent before they are in place is likely to land in spam.

**Moving to another mail service** (Lettermint, Brevo): the API only assumes SMTP. Change `smtpHost()`, `smtpPort` and, if the sender changes, `mailFrom` in `src/environments.ts` (a pull request), set `SMTP_USER` and `SMTP_PASSWORD` to the service's SMTP login, put the service's SPF and DKIM records at the registrar, then run Provision with `apply` and restart the services.

## First run, in this order

The workflows reach the environments only from `main`, so the first runs happen after pull request 8 is merged.

1. **Secrets** in both environments, as above, and the mailbox (see "Mail").
2. **Add the deploy public key** `padvinder-deploy.pub` to the main SSH user `<account>` in the panel (see "Deploy key"). That user came with the account; no SSH user is created.
3. **Merge pull request 8.** Its Deploy run fails safely, because nothing is provisioned yet: the staging job loads the key, unpacks the release and asks the API for the services, then stops with `Deploy failed: Found no service "padvinder-api (staging)". Found no service "padvinder-worker (staging)". Run pnpm infra:provision --environment staging to see what differs.` It has not used SSH or changed anything, and production does not start, because it needs the staging job.
4. **Plan staging, read-only.** Actions, Provision, Run workflow (from `main`), environment `staging`, `apply` off, `inspect` on. Nothing changes, and SSH is not used. Check the plan, and compare the inspect output with the `UNVERIFIED` fields in `src/resources.ts`. If the names differ, fix them there in a pull request, merge it (its Deploy run fails as in step 3) and plan again.
5. **Apply staging.** The same with `apply` on. It first reads `padvinder/staging/.env` over SSH (there is none yet); if the key from step 2 is missing, it stops there with nothing changed and says so. Then it creates the database, the database user, the site and the two services, writes `padvinder/staging/.env` and creates `releases/`.
6. **Deploy to staging.** Actions, Deploy, Run workflow (from `main`); or re-run the failed run of step 3. The services start failing as soon as they are created (no release yet), and Alwaysdata may turn them off; the first deploy turns them on. The production job then waits for approval: reject it for now (Review deployments): production is not provisioned yet, and a deploy waiting in the group `deploy-production` gets in the way of provisioning it (see "Operating notes").
7. **Verify** staging: the "Verification" section below.
8. **Production:** steps 4 and 5 with `production`. Each run waits for your approval, also a plan. The key is already on the main SSH user. Then run Deploy again from `main`, check staging, and approve the production job.

## Rolling out login

The login pull request makes the API refuse to start without `PUBLIC_ORIGIN`, `AUTH_SECRET`, `SMTP_HOST`, `SMTP_PORT` and `MAIL_FROM`, which only that pull request's provisioning code writes to the env file. The worker does not need them. The Provision workflow runs from `main` only, so there are two orders. The first one keeps every deploy green; the second one is the fallback.

Both start the same:

1. **Secrets:** `AUTH_SECRET`, `SMTP_USER` and `SMTP_PASSWORD` in both environments (see "Making each value"). Until they are set, Provision stops with `Set these environment variables: AUTH_SECRET, SMTP_USER, SMTP_PASSWORD` and changes nothing.
2. **Mailbox** `noreply@padvinder.net` on the account, with the password of `SMTP_PASSWORD` (see "Mail").
3. **DNS:** the SPF, DKIM and DMARC records at the registrar (see "DNS"). They may take a while; login works without them, but mail is likely to land in spam until they are in place.

**Safer order: provision from the branch before merging.**

4. On your machine, check out the login pull request's branch and run `pnpm infra:provision --environment staging --apply` with the settings of "Running locally" (including `AUTH_SECRET`, `SMTP_USER` and `SMTP_PASSWORD`, the same values as the GitHub secrets). The plan is `ok` for every resource; it rewrites `padvinder/staging/.env` with the login lines. Do not restart: the running API ignores variables it does not know, so it keeps working on the new file. Do the same for `production` if you want to approve production right after the merge.
5. **Merge.** Do not run the Provision workflow from `main` between step 4 and the merge: `main`'s code would write the env file without the login lines again.
6. The Deploy run of the merge now passes on staging. When its production job asks for approval, approve it if step 4 covered production; otherwise reject it, provision production (Provision workflow, `apply` on) and run Deploy from `main` again.
7. **Check staging:** log in on `https://staging.padvinder.net/app/` with an address of your own, and work through the login rows in "Verification".

**Fallback: if the merge's Deploy ran before provisioning.**

4. **Merge** without step 4 above. Its Deploy run fails safely on staging, unless you cancel it while it is still at `release / build`. What you see: the migrations run (they only add tables, so the old release keeps working on them), `current` switches, the services restart, and the new API exits at once with `Invalid API environment: AUTH_SECRET: ...; PUBLIC_ORIGIN: ...; SMTP_HOST: ...; SMTP_PORT: ...; MAIL_FROM: ...` in its service log (`admin/logs/services/`). The health check gives up after 3 minutes, the deploy switches back to the previous release, restarts, and fails with `Deploy of <commit> failed its health check and was rolled back to <previous release>. ... The rollback to <commit> passed its health check.` Staging keeps running the old release. The production job does not start, because it needs the staging job.
5. **Provision staging:** Actions, Provision, environment `staging`, `apply` on. The plan is `ok` for every resource; it rewrites `padvinder/staging/.env` with the login lines and says the services must be restarted. No restart needed now: the next step restarts them.
6. **Deploy to staging:** re-run the failed Deploy run (Re-run failed jobs), or run Deploy from `main`. When its production job asks for approval, reject it for now (a deploy waiting in `deploy-production` gets in the way of provisioning production, see "Operating notes").
7. **Check staging:** as in step 7 above.
8. **Production:** Provision `production` with `apply` on (it waits for your approval), then run Deploy from `main` again, and approve its production job.

If production has not been provisioned at all yet, provisioning it is its first run ("First run", step 8); the secrets of step 1 are then already in place.

## Running locally

The same commands work on your machine with the settings in the environment variables. Keep the key and the known-hosts file outside the repository. Do not pass secrets as arguments, and do not put them in `.env` files in the repository. For example, in bash or zsh:

```sh
export ALWAYSDATA_ACCOUNT='<account>'
read -rs ALWAYSDATA_API_KEY && export ALWAYSDATA_API_KEY        # paste, Enter
read -rs DATABASE_PASSWORD && export DATABASE_PASSWORD          # only for provisioning
read -rs AUTH_SECRET && export AUTH_SECRET                      # only for provisioning
read -rs SMTP_USER && export SMTP_USER                          # only for provisioning
read -rs SMTP_PASSWORD && export SMTP_PASSWORD                  # only for provisioning
export DEPLOY_SSH_KEY_FILE="$HOME/.ssh/padvinder-deploy" SSH_KNOWN_HOSTS_FILE="$HOME/.ssh/padvinder-known-hosts"   # outside the repository
pnpm infra:provision --environment staging
```

To try the agent path as CI takes it, start a dedicated agent with only the deploy key for this shell and point `DEPLOY_SSH_AGENT_SOCK` at it:

```sh
unset DEPLOY_SSH_KEY_FILE
eval "$(ssh-agent -s)" && ssh-add -t 1h "$HOME/.ssh/padvinder-deploy"   # or pipe the key in: ssh-add -t 1h -
export DEPLOY_SSH_AGENT_SOCK="$SSH_AUTH_SOCK"
pnpm infra:provision --environment staging
ssh-agent -k                                                          # stop it when done
```

`DEPLOY_SSH_AGENT_SOCK="$SSH_AUTH_SOCK"` with your own agent also works, as a deliberate choice: ssh then offers every key that agent holds, and a server stops after a few wrong ones.

A local deploy needs a release built from a clean tree:

```sh
pnpm release:build
pnpm infra:deploy --environment staging --tarball padvinder-release.tar.gz --commit "$(git rev-parse HEAD)"
```

## Administration tool

The maintainer creates organizations and working groups, and gives roles, with `api/dist/admin.js`, which is part of every release. It needs only `DATABASE_URL`. Run it over SSH from the live release, with the same two env files as the services. `NODEJS_VERSION=24` is needed because the default Node of an SSH session is not guaranteed (the deploy step sets it too):

```sh
ssh <account>@ssh-<account>.alwaysdata.net
cd padvinder/<env>/current
NODEJS_VERSION=24 node --env-file=release.env --env-file=../../.env api/dist/admin.js list
NODEJS_VERSION=24 node --env-file=release.env --env-file=../../.env api/dist/admin.js --help   # all commands
```

`list` prints organizations and working groups with their IDs, and no personal data. The other commands print an ID or `changed` or `unchanged`; an error is one line on stderr and exit code 1. The grant commands create the account when the address is unknown (and then print `changed (new account for <address>)`), so check the address carefully. Every change is written to the audit log with the system as actor. The first platform admin is made this way: `grant-platform-admin --email <address>`; the person then logs in with that address. The deploy smoke test runs `list` once, so CI proves the tool is in the artifact. Locally, use `pnpm admin <command>` from the repository root.

## Operating notes

- **Merging to `main`** deploys to staging, then waits for your approval for production. Approve in the run (Review deployments).
- **A branch on staging:** only by merging it, or by the maintainer locally with the CLI (`pnpm release:build` on the branch, then `pnpm infra:deploy --environment staging`, see "Running locally"). GitHub never deploys a branch other than `main`: the environments allow `main` only (see "GitHub setup"). After a local deploy of a branch, run Deploy from `main` to put `main` back on staging.
- **A branch's migrations stay on staging.** Deploying a branch locally applies its migrations to the staging database, and Drizzle tracks migrations by name. If such a migration is later changed or dropped before the merge, staging no longer matches `main`'s migrations: the changed one is never run again, and a dropped one's tables stay. When that happens, recreate the staging database (drop it in the panel and run Provision with `apply`, which creates it with the right locale) or restore it from a backup taken before the branch, then deploy `main` again.
- **A skipped production job shows green.** When you approve an older run after `main` has moved on, the production job deploys nothing; its summary has the notice "Skipped: main has moved on". The newest run deploys the newest commit.
- **Rollback.** A failed health check rolls back on its own. For a manual rollback of production: revert the change on `main` (a pull request), which deploys the reverted state; re-running an older run's production job does not work, because it skips when its commit is no longer the head of `main`. In a hurry, deploy an older commit locally (check it out, `pnpm release:build`, `pnpm infra:deploy`). Re-running an older run's staging job does put that older commit on staging, as long as its artifact exists (30 days).
- **Do not start Provision (either environment) or Staging services while a deploy of that environment is queued.** They share the concurrency group `deploy-<env>` (`deploy-staging` and `deploy-production`), and GitHub cancels a pending run when a newer one joins the group. A running job is never cancelled. If a deploy was cancelled this way, re-run it (Re-run failed jobs).
- **Provisioning never restarts the services.** When the env file changed it prints `The services must be restarted ...`. Restart with `pnpm infra:services --environment <env> --restart` locally, in the panel (Advanced, Services), or by deploying again.
- **Logs** are in `/home/<account>/admin/logs/services/<folder>/<service id>-<date>.log` (service output: API and worker, with Alwaysdata's own lines), `/home/<account>/admin/logs/http/` (requests) and `/home/<account>/admin/logs/sites/` (site starts and errors). Read them over SSH, or in the panel. The deploy steps are in the GitHub Actions run.
- **Processes and memory:** the panel, Advanced, Processes. Services run on servers separate from SSH.
- **Backups:** Alwaysdata makes a daily dump in `/home/<account>/admin/backup/<date>/postgresql/<database>.sql.zst`. A second, hourly copy elsewhere during the season is planned, not built.

- **Mails from staging carry `[STAGING]`.** After the pull request that added `MAIL_SUBJECT_PREFIX` is merged, run Provision for `staging` with `apply` on once (it rewrites the env file with the new line), then restart staging's services (`pnpm infra:services --environment staging --restart`) or wait for the next deploy. Until then staging's mails have no prefix; nothing breaks.

### Rotation schedule

| Secret                                  | Why                                                                                                 | When                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALWAYSDATA_API_KEY`                    | Full rights of the profile over the whole account; the public docs do not say whether tokens expire | Every January (before the feature freeze around 1 February, so nothing changes during the season), and at once when a log or a runner may have exposed it           |
| `DEPLOY_SSH_KEY`                        | Full SSH access to the account                                                                      | Every January, together with the API token                                                                                                                          |
| `DATABASE_PASSWORD` (per environment)   | Readable on the server in `padvinder/<env>/.env` by anything on the account                         | Every January; at once when someone with access leaves, or on suspicion                                                                                             |
| `SMTP_PASSWORD` (both environments)     | Sends mail as `noreply@padvinder.net`; readable on the server in both env files                     | Every January, together with the database passwords; at once when someone with access leaves, or on suspicion                                                       |
| `AUTH_SECRET` (per environment)         | Signs the sessions and encrypts the stored login codes; readable on the server in the env file      | Not on a schedule: rotating it logs every user of that environment out, and open login codes stop working. At once when someone with access leaves, or on suspicion |
| `ALWAYSDATA_ACCOUNT`, `SSH_KNOWN_HOSTS` | Not real secrets; secrets only to stay out of public logs                                           | Only when the account moves or Alwaysdata changes its host key                                                                                                      |
| `SMTP_USER`                             | Not a real secret on Alwaysdata (the sender address); a secret for another mail service's login     | Only when the mailbox or the mail service changes                                                                                                                   |

"At once" also covers a lost or compromised laptop that held a key or token, and anyone losing access.

Secrets that later slices add get a row here when they are added. Example: the VAPID key pair (rotating it invalidates every push subscription, so devices must subscribe again). This is guidance for whoever adds them, not a list of existing rows.

The workflow `rotation-reminder.yml` opens an issue every 1 January with a checklist. How to rotate each secret is in the next section.

### Rotating a secret

- **Database password:** set a new `DATABASE_PASSWORD` in the environment (`openssl rand -hex 32 | gh secret set ...`), then run Provision with `apply` and `rotate-password` on. Without `rotate-password` the run refuses, because the env file would then disagree with the database user. Then restart the services straight away: new database connections fail until they run with the new file.
- **API token:** make a new token in the panel, set `ALWAYSDATA_API_KEY`, delete the old token in the panel.
- **Deploy key:** make a new key pair, add the new public key to the main SSH user `<account>` in the panel, set `DEPLOY_SSH_KEY` in both environments, check that a deploy or a Provision apply works, then remove the old public key in the panel. The key must have no passphrase: the action loads it into ssh-agent without a prompt, and fails with "Could not load DEPLOY_SSH_KEY into ssh-agent" otherwise.
- **SSH host key** (only if Alwaysdata changes it): make `SSH_KNOWN_HOSTS` again, after checking the fingerprint.
- **Mailbox password:** make a new one (`openssl rand -hex 32 > smtp-password` in a temporary directory), set `SMTP_PASSWORD` in both environments, change the password of `noreply@padvinder.net` in the panel (Emails, Addresses), then run Provision with `apply` for staging and for production and restart both environments' services (`pnpm infra:services --environment <env> --restart`). From the change in the panel until the restart no login mail goes out; users press "Stuur opnieuw" after it. Do it at a quiet moment.
- **Login secret:** `openssl rand -hex 32 | gh secret set AUTH_SECRET --env <env> ...`, Provision with `apply` (no `rotate-password`: that is for the database password only), then restart the services. Every user of that environment is logged out and must ask for a new code.

### Turning staging off and on

Staging shares 1 GB of RAM with production. Actions, Staging services, Run workflow, `off` or `on`; locally `pnpm infra:services --environment staging --disable` or `--enable`. A deploy to staging turns it on again. Staging stays on by default (decided 22 November 2026, after the memory measurement in "Verification").

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

There are no MX or CAA records.

**To do for mail** (see "Mail"; the values come from the Alwaysdata panel, Domains, `padvinder.net`, DNS records, and are not written here):

- [ ] SPF: add Alwaysdata's `include:` mechanism to the existing SPF `TXT` record of `padvinder.net`. Keep one SPF record; a second one makes SPF fail.
- [ ] DKIM: the `TXT` record Alwaysdata shows for `padvinder.net` (a name under `_domainkey.padvinder.net`).
- [ ] DMARC: a `TXT` record at `_dmarc.padvinder.net`. Start with policy `none`, and tighten it once "Verification" shows SPF and DKIM passing.
- [ ] Decide whether `padvinder.net` gets MX records pointing at Alwaysdata. Without them, bounces and replies to `noreply@padvinder.net` reach nobody; sending works either way.

Record each one in the table above (name and type only) once it exists. `www.padvinder.net` resolves, but no PadVinder site serves it, so it has no certificate. Either add it to the production site (with a redirect) or remove the records; that is a decision for the maintainer.

Let's Encrypt only issues a certificate when the address already points at Alwaysdata, so DNS comes before the site.

## Rebuilding from scratch

### On a new Alwaysdata account

1. Make the account, its API token, the mailbox (see "Mail") and the GitHub secrets for it (`ALWAYSDATA_ACCOUNT`, `ALWAYSDATA_API_KEY`, `SSH_KNOWN_HOSTS` change, and `SMTP_PASSWORD` if the new mailbox has another password; keep or remake the others; keep `AUTH_SECRET` so nobody is logged out). The DKIM record of the new account replaces the old one at the registrar.
2. Follow "First run" up to and including the apply, for each environment.
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

3. **Release.** Unpack `padvinder-release.tar.gz`, write an env file with the variables of "Server layout" (mode 600, outside the release; `SMTP_*` and `MAIL_FROM` of the new host's mail service), then from inside `release/`:

   ```sh
   node --env-file=release.env --env-file=<env file> api/dist/migrate.js migrations
   node --env-file=release.env --env-file=<env file> api/dist/main.js      # as a service
   node --env-file=release.env --env-file=<env file> worker/dist/main.js   # as a second service
   ```

   Or run the container image from `infra/container/Dockerfile` twice, once per program. Run both under a supervisor that restarts them (systemd or similar).

4. **Files:** copy uploads once they exist. **DNS:** point the records above at the new host, and let the proxy get certificates.

## Verification

The first deploy to staging (22 November 2026, commit 1a80783, from the maintainer's machine with `pnpm infra:deploy`) is also the test the project plan asks for. Results are recorded here with their dates. Still open: production (not provisioned or deployed yet), the PostGIS "core procs need upgrade" message (Alwaysdata support asked, 22 November 2026), and the monitoring command, which is deliberately not set (external monitoring of `/api/health` is preferred). Decision: staging stays on by default; revisit when slice 1 adds authentication and email, and before the season.

| What                                                                                                                                                                                                                                                                                      | How to check                                                                                                                     | Status                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pg-boss runs the worker heartbeat every minute                                                                                                                                                                                                                                            | `/api/health` shows a fresh `worker.lastHeartbeatAt`; watch it for a few minutes                                                 | confirmed 22 November 2026: heartbeat every minute; the schedule is stored with time zone `Europe/Amsterdam` (`pgboss.schedule`)                                                                                                                                                                                                                                                    |
| pg-boss comes back after Alwaysdata restarts the worker                                                                                                                                                                                                                                   | Restart the worker (`pnpm infra:services --restart` or the panel); the heartbeat resumes                                         | confirmed 22 November 2026: the heartbeat resumes after a restart                                                                                                                                                                                                                                                                                                                   |
| The worker really restarts on a deploy (the health check cannot tell an old worker's heartbeat from a new one)                                                                                                                                                                            | Panel, Advanced, Processes: the worker's start time after a deploy; the service log shows the shutdown on `SIGHUP`               | confirmed 22 November 2026: the service log shows "Received SIGTERM, shutting down" and "Worker started" at each deploy                                                                                                                                                                                                                                                             |
| A restart makes API and worker exit cleanly and start again (Alwaysdata sends `SIGTERM`)                                                                                                                                                                                                  | Service log in `admin/logs/services/` after a restart                                                                            | confirmed 22 November 2026, but it is `SIGTERM`, not `SIGHUP`: both log "Received SIGTERM, shutting down", exit 0 within about 1 s and are back within about 2 s. The `SIGHUP` handler stays, harmless                                                                                                                                                                              |
| An SSE connection to `/api/events` stays open for an evening without buffering by the proxy                                                                                                                                                                                               | `curl -N https://staging.padvinder.net/api/events` for an evening; heartbeat events arrive at once, not in bursts                | confirmed 22 November 2026: unbuffered; keepalives exactly every 25 s, worker heartbeats on time; one connection stayed open 33 minutes without a gap over 40 s until a restart closed it cleanly, and the client reconnected within 5 s (about 45 minutes observed in total, not a full evening)                                                                                   |
| `LISTEN`/`NOTIFY` works on port 5432                                                                                                                                                                                                                                                      | Worker heartbeats arrive over SSE (they travel by `NOTIFY`)                                                                      | confirmed 22 November 2026: events travel worker, PostgreSQL, API, SSE                                                                                                                                                                                                                                                                                                              |
| PostGIS version, and whether `postgis_full_version()` still says "core procs need upgrade" on the new databases                                                                                                                                                                           | `select postgis_full_version()`; if it does, ask Alwaysdata support to run the upgrade                                           | PostgreSQL 18.7 and PostGIS 3.6.2 confirmed 22 November 2026. OPEN: on 22 November 2026 `postgis_full_version()` on the staging database still says "core procs need upgrade"; the maintainer asked Alwaysdata support to run the upgrade. Check again after their answer, and on the production database                                                                           |
| The migrations run with the database user's rights                                                                                                                                                                                                                                        | The first deploy's migration step                                                                                                | confirmed 22 November 2026: the first deploy migrated with the database user's rights; `CREATE EXTENSION IF NOT EXISTS postgis` is a no-op (PostGIS already enabled)                                                                                                                                                                                                                |
| Database encoding `UTF8` and locale `C.UTF-8`                                                                                                                                                                                                                                             | `select datcollate, datctype, datlocprovider, pg_encoding_to_char(encoding) from pg_database where datname = current_database()` | the migrate step's check of encoding and locale passed on the first deploy (22 November 2026)                                                                                                                                                                                                                                                                                       |
| The database accepts TLS connections from outside                                                                                                                                                                                                                                         | `psql "sslmode=require host=postgresql-<account>.alwaysdata.net ..."` from your machine                                          | confirmed 22 November 2026: STARTTLS on 5432, valid Let's Encrypt certificate for `*.alwaysdata.net`. Port 5432 is reachable from the internet, so the database password is its only protection                                                                                                                                                                                     |
| Time zones: the server's, the database's, and that of scheduled jobs                                                                                                                                                                                                                      | `date` and `echo "$TZ"` over SSH, `show timezone` in `psql`; pg-boss schedules use Europe/Amsterdam explicitly                   | confirmed 22 November 2026: server (SSH and services) CET through `/etc/localtime`; PostgreSQL session `GMT` (UTC, as the spec wants); pg-boss schedule `Europe/Amsterdam`                                                                                                                                                                                                          |
| Memory use of the four processes (API and worker, production and staging) fits in 1 GB                                                                                                                                                                                                    | Panel, Advanced, Processes, after a day of use                                                                                   | staging measured 22 November 2026 (panel, about 35 minutes after the deploy): API and worker about 79 MB together, flat over 30 minutes; start-up peak about 180 MB; per process at most API 80 MB, worker 65 MB; reverse proxy about 13 MB. Projection for both environments: about 185 MB steady, about 315 MB if all restart at once, of 1 GB. OPEN: production not measured yet |
| The non-interactive shell of the main SSH user `<account>` prints nothing (rsync and the deploy's output depend on it)                                                                                                                                                                    | `ssh <account>@ssh-<account>.alwaysdata.net true` prints nothing; the first deploy's upload works                                | confirmed 22 November 2026: rsync and the remote commands of the first deploy worked                                                                                                                                                                                                                                                                                                |
| `NODEJS_VERSION=24` gives Node.js 24 in the services and over SSH                                                                                                                                                                                                                         | `NODEJS_VERSION=24 node --version` over SSH; the health check passing                                                            | confirmed 22 November 2026: the new commit passed its health check                                                                                                                                                                                                                                                                                                                  |
| The API requires `ssh_user` on a service (confirmed 22 November 2026: 400 without it); both services name the main SSH user `<account>`. UNVERIFIED: the form in which a listed service reports `ssh_user` (an id is assumed; an object with `id` or `href`, or an href, is accepted too) | `--inspect` after the first apply shows `ssh_user` of our services; a second plan shows them `ok`                                | confirmed 22 November 2026: services run as the main SSH user, looked up by name; the first deploy and restart worked                                                                                                                                                                                                                                                               |
| Database fields `locale` (`"C.UTF-8"`) and `extensions` (`["postgis"]`), create-only. The API has no `encoding` field: the migrate step's check of encoding and locale is the gate                                                                                                        | `--inspect`, and the SQL check above                                                                                             | confirmed 22 November 2026 (`--inspect`); encoding by the SQL check not yet verified                                                                                                                                                                                                                                                                                                |
| `database/user.permissions` is keyed by database name and lists every database of the account (`NONE` where the user has no rights)                                                                                                                                                       | `--inspect`                                                                                                                      | confirmed 22 November 2026                                                                                                                                                                                                                                                                                                                                                          |
| A site does not keep the `name` sent on create, so provisioning finds it by its first address                                                                                                                                                                                             | `--inspect`; a second plan shows the site `ok`                                                                                   | confirmed 22 November 2026                                                                                                                                                                                                                                                                                                                                                          |
| The reverse proxy's target field is `url` (confirmed 22 November 2026: the API requires it). UNVERIFIED: that the proxy reaches `http://services-<account>.alwaysdata.net:<port>` over IPv6                                                                                               | `--inspect`; `https://staging.padvinder.net/api/health` answers                                                                  | confirmed 22 November 2026: `/api/health` answers 200 through the proxy over https; `/app/`, `/app/more`, `/` and `/app/manifest.webmanifest` are served; http redirects to https (301)                                                                                                                                                                                             |
| UNVERIFIED: site `addresses` order                                                                                                                                                                                                                                                        | A second plan shows `ok`                                                                                                         | confirmed 22 November 2026: addresses are stored with the root path (`staging.padvinder.net/`) and sites are matched on that                                                                                                                                                                                                                                                        |
| UNVERIFIED: service `environment` format (`NAME=value`, space-separated)                                                                                                                                                                                                                  | `--inspect`                                                                                                                      | confirmed 22 November 2026: the services start with the env they are given (the health check passed)                                                                                                                                                                                                                                                                                |
| UNVERIFIED: the service on/off field `is_disabled`                                                                                                                                                                                                                                        | Staging services off and on; the panel shows the change                                                                          | confirmed 22 November 2026: the restart through the API also started services that Alwaysdata had stopped after "maximum restart attempts reached" before the first release. OPEN: switching staging off and on from the workflow not tried                                                                                                                                         |
| The ssh-agent of the credentials step outlives that step on GitHub's runner, and the job's last step stops it                                                                                                                                                                             | The deploy's upload works; the step "Stop the SSH agent" prints nothing (not "had already stopped")                              | not yet verified on GitHub's runner; the first deploy was run from the maintainer's machine (22 November 2026)                                                                                                                                                                                                                                                                      |
| The status codes of the API's `PATCH` and `restart` (the fake answers 204)                                                                                                                                                                                                                | The first apply and deploy succeed                                                                                               | confirmed 22 November 2026: the first provision and deploy succeeded                                                                                                                                                                                                                                                                                                                |

Login and mail, after the rollout of login ("Rolling out login"):

| What                                                                                                                                                                      | How to check                                                                                                                                                                                             | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The API logs in to `smtp-<account>.alwaysdata.net` on port 465 with TLS as `noreply@padvinder.net`. Taken from Alwaysdata's login details page, which lists only port 465 | Ask for a code on staging; the mail arrives. A failure is in the API's service log (`admin/logs/services/`), without the address                                                                         | OPEN   |
| A login code reaches Gmail, Outlook, iCloud, KPN and Ziggo inboxes, not the spam folder                                                                                   | Ask for a code for an address at each; look in the inbox and the spam folder                                                                                                                             | OPEN   |
| SPF, DKIM and DMARC pass                                                                                                                                                  | In Gmail, "Show original" on a code mail: `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. If they do not pass after the DNS records are in place, move to a mail service                                       | OPEN   |
| Alwaysdata's reverse proxy passes the client's IP address in a header the client cannot forge, so the login limit per IP address means something                          | Ask for codes with a forged `X-Forwarded-For`; the limit must follow the real address (look at the keys in `rate_limits`; sessions do not store the address). If not, all users share one limit per path | OPEN   |

When a name differs, change it in `src/resources.ts` only, and the fake in `src/testing/fake-api.ts` if its answers differ.
