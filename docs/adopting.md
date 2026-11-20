# Adopting

How a product moves from its own workflows to these, and what it deletes after.

## TL;DR

| Step | Do |
|---|---|
| 1 | Copy `starters/ci.yml` and `starters/deploy.yml`, and `rollback.yml`, `preview.yml` or `release.yml` when the product has them |
| 2 | Set the Worker folder, D1 binding, smoke path and address in `deploy.yml`, one job per Worker |
| 3 | Create the `production` and `preview` environments, each with its own `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| 4 | Delete the workflows the new ones replace (table below) |
| 5 | Open a pull request: `ci` runs on it; merging runs `deploy` |

## 1. What each old workflow becomes

| Old workflow | Becomes |
|---|---|
| `ci.yml` (on push and pull request) | `ci.yml` starter, pull requests only; main is checked inside `deploy.yml` |
| `standards.yml` | A step of `ci.yml` (set `STANDARDS_APP_CLIENT_ID` and `STANDARDS_APP_PRIVATE_KEY`) |
| `no-ai-coauthors.yml` | A step of `ci.yml` (`guard`) |
| A Worker deploy, or a reusable deploy of the product's own | `deploy.yml` starter |
| `rollback.yml` | `rollback.yml` starter |
| An npm publish | `release.yml` starter; keep the release-please config |
| A PyPI publish | `release-pypi.yml` starter |
| A GitHub Packages publish | `npm-publish` with `registry: github` |
| A sync to a mirror repository with a personal access token | `mirror` with a GitHub App; delete the personal token |
| An MCP registry publish | `mcp-registry` |
| A static site's deploy | [Workers Builds](workers-builds.md), and delete the job |
| A workflow that starts submodules' CI | Delete: each submodule repository checks itself with its own `ci.yml` |
| A cron that checks a live service (health, smoke) | A cron trigger on a Worker, which Cloudflare runs for free, or a scheduled run on a self-hosted runner |
| A daily cron that opens a pull request (a dependency bump) | Weekly, or Renovate or Dependabot, which run on GitHub's side for free |

## 2. Environments and tokens

- **One token per environment.** `production` and `preview` each hold a Cloudflare token scoped to that
  environment's Workers and databases (`packs/cloudflare/ci-cd.md`, section 3). A preview token can never touch
  production.
- **Approval.** On `production`, allow only the `main` branch, and add a required reviewer where the plan allows it.
  GitHub offers required reviewers on private repositories only on paid plans; on a free plan, deploy production from a
  manual run (`workflow_dispatch`) instead, which is the approval.
- **The standards app.** `STANDARDS_APP_CLIENT_ID` (a variable) and `STANDARDS_APP_PRIVATE_KEY` (a secret) are set
  once on each organisation, not per repository.

## 3. A monorepo with several Workers

One job per Worker in `deploy.yml`, each `needs: ci`. They run side by side, each installing once. When the Workers
depend on each other's order (an API before the site that calls it), chain them with `needs`.

## 4. What stays the product's own

- Scripts in `package.json`: `check` runs lint, types and tests; `check:deploy` runs `wrangler deploy --dry-run`.
  The workflows call those names, so each product decides what they do.
- Anything only one product has (mobile builds, a data pipeline, an SDK mirror). Keep it in the product, and give it
  `runs-on: ${{ fromJSON(vars.CI_RUNS_ON || '"ubuntu-latest"') }}`, `concurrency` and `paths` like the starters.

## 5. Order to move the products

Start with the repository that spends the most minutes: the organisation's billing page lists them by repository.
The usual first changes, in order of what they save:

| Symptom | First change |
|---|---|
| A daily cron that opens a pull request | Weekly, or Dependabot |
| Several small workflows on every push | One `ci` on pull requests |
| A deploy of every app on every push | Gate each Worker's job on its area |

## See also

| Doc | Why |
|---|---|
| [README](../README.md) | What each workflow and action does |
| [Runners](runners.md) | Making every run free |
| [GitHub: environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments) | Protection rules and environment secrets |
