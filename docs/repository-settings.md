# Repository settings

These settings live on GitHub, not in the repository, so the maintainer applies them by hand once. Nothing here runs automatically. Replace `OWNER/REPO` with the real repository. The repository is public, so every feature below is free.

The CI workflow (`.github/workflows/ci.yml`) must have run at least once on a pull request before GitHub offers its checks in the lists below.

## 1. Ruleset for `main`

Settings, Rules, Rulesets, New ruleset, New branch ruleset.

- Name: `main`. Enforcement status: Active. Target branches: Add target, Include default branch.
- Turn on:
  - Restrict deletions.
  - Require linear history.
  - Require a pull request before merging. Required approvals: 0 while there is one developer; raise it when there are more. Allowed merge methods: squash and rebase (linear history rules out merge commits).
  - Require status checks to pass. Turn on "Require branches to be up to date before merging". Add these checks: `check`, `visual`, `e2e`, `scan` and `release / build`. Confirm the exact names in the picker after the first run: a job that calls a reusable workflow shows as `<caller job> / <called job>`, which is why the last one is `release / build`. Do not add `deploy-test` (workflow `deploy-test.yml`): it runs only on pull requests that touch the deploy path, a path-filtered workflow reports nothing on other pull requests, and a required check that never reports blocks the merge. The CI jobs `visual`, `e2e` and `release / build` may skip when a pull request does not affect them; they are safe to require, because a job skipped by its condition reports as passed.
  - Block force pushes.
- Bypass list: leave empty, so the rules also apply to admins.

The same through the API (a ruleset with these rules; check the names first with `gh api repos/OWNER/REPO/commits/<sha>/check-runs --jq '.check_runs[].name'`):

```sh
gh api repos/OWNER/REPO/rulesets --method POST --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "check" },
          { "context": "visual" },
          { "context": "e2e" },
          { "context": "scan" },
          { "context": "release / build" }
        ]
      }
    }
  ]
}
JSON
```

Classic branch protection (Settings, Branches) offers the same options if you prefer it; use one of the two, not both.

## 2. Actions settings

Settings, Actions, General.

- Actions permissions: "Allow PadVinder-net, and select non-PadVinder-net, actions and reusable workflows". Under it, turn on "Allow actions created by GitHub", leave "Allow Marketplace actions by verified creators" off, and add `pnpm/action-setup@*` to "Allow specified actions and reusable workflows". That is the one third-party action (used by `.github/actions/setup`); without it every job fails with "action not allowed". Turn on "Require actions to be pinned to a full-length commit SHA". The workflows already pin every action this way, with the version as a comment, and that setting enforces it, so the `@*` pattern is safe.
- The organization (Settings, Actions, General of PadVinder-net) has its own Actions policy, and it can override the repository one: a repository cannot be more permissive than the organization. If a setting here is greyed out or an action is refused, check the organization policy first.
- Workflow permissions: "Read repository contents and packages permissions" (read-only `GITHUB_TOKEN` by default). Leave "Allow GitHub Actions to create and approve pull requests" off. Workflows also set `permissions: contents: read` themselves. The yearly rotation reminder (`rotation-reminder.yml`) needs `issues: write`; the workflow requests that itself, so the read-only default stays.
- Fork pull request workflows: "Require approval for first-time contributors who are new to GitHub" at least; "Require approval for all external contributors" is stricter and fine for this project. Leave "Send write tokens to workflows from pull requests" and "Send secrets and variables to workflows from pull requests" off.

Through the API:

```sh
gh api repos/OWNER/REPO/actions/permissions --method PUT -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api repos/OWNER/REPO/actions/permissions/selected-actions --method PUT --input - <<'JSON'
{ "github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": ["pnpm/action-setup@*"] }
JSON
gh api repos/OWNER/REPO/actions/permissions/workflow --method PUT -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
gh api repos/OWNER/REPO/actions/permissions/fork-pr-contributor-approval --method PUT -f approval_policy=all_external_contributors
```

If one of these fields is rejected, GitHub renamed it: use the settings page, which is the reference.

## 3. Security settings

Settings, Advanced Security (called "Code security and analysis" in older layouts).

- Dependabot alerts: Enable.
- Dependabot security updates: Enable.
- Dependabot version updates: already configured by `.github/dependabot.yml`. After the first push to `main`, check Insights, Dependency graph, Dependabot that all four ecosystems parse without errors.
- Secret scanning: Enable.
- Push protection: Enable. It blocks a push that contains a known secret. The `scan` job in CI is a second line: it also checks the whole history.

Through the API:

```sh
gh api repos/OWNER/REPO --method PATCH --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" }
  }
}
JSON
gh api repos/OWNER/REPO/vulnerability-alerts --method PUT
gh api repos/OWNER/REPO/automated-security-fixes --method PUT
```

## 4. Environments for deployment

Settings, Environments. The workflows in `.github/workflows/` (`deploy.yml`, `provision.yml`, `staging-services.yml`) enter these environments, and only there do they see the secrets. Where each value comes from is in `infra/alwaysdata/README.md`, "GitHub setup".

- [ ] Environment `staging`. Deployment branches and tags: Selected branches and tags, with the one branch rule `main`. No required reviewers.
- [ ] Environment `production`. Required reviewers: the maintainer. "Prevent self-review" off, or one maintainer blocks himself. Deployment branches and tags: the one branch rule `main`.
- [ ] In both environments, the five secrets: `ALWAYSDATA_API_KEY`, `DEPLOY_SSH_KEY`, `DATABASE_PASSWORD` (a different one per environment), `ALWAYSDATA_ACCOUNT` and `SSH_KNOWN_HOSTS`. There are no variables: GitHub prints the `env:` values of a non-secret in the step log, and the logs are public (the account name and the known-hosts line, which holds the account name, would show). One deploy key may serve both environments: both log in as the account's main SSH user.

Through the API (the environment names are created on the first call; add the secrets with `gh secret set`, see the README):

```sh
gh api repos/OWNER/REPO/environments/staging --method PUT --input - <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api repos/OWNER/REPO/environments/staging/deployment-branch-policies --method POST -f name=main -f type=branch

REVIEWER_ID=$(gh api users/<login> --jq .id)   # the maintainer's GitHub login
gh api repos/OWNER/REPO/environments/production --method PUT --input - <<JSON
{
  "reviewers": [{ "type": "User", "id": $REVIEWER_ID }],
  "prevent_self_review": false,
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
gh api repos/OWNER/REPO/environments/production/deployment-branch-policies --method POST -f name=main -f type=branch
```

Secrets are per environment: set each in both. Do not add other branches (such as `staging/**` or `provision/*`), not even to staging: both environments are on one Alwaysdata account, where every SSH user and API token reaches everything, so whoever can run code in `staging` can read production's secrets. Only reviewed code on `main` may hold them; `infra/alwaysdata/README.md`, "GitHub setup", explains this. To check: `gh api repos/OWNER/REPO/environments/<env>/deployment-branch-policies --jq '.branch_policies[].name'` prints `main` only, for both.

## 5. Check afterwards

- Open a pull request and confirm that all five checks run and that the merge button waits for them.
- Try pushing directly to `main`, and force-pushing: both must be refused.
- A required check that never reports blocks the merge forever. If a job is renamed in the workflow, update the ruleset in the same change.
