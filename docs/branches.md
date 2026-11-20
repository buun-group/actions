# Branches

The branch flow every repository follows, and how the workflows hold it where GitHub's own branch protection does not
reach.

## TL;DR

| Branch | Takes pull requests from | Deploys to | Releases as |
|---|---|---|---|
| `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `perf/*`, `test/*`, `ci/*`, `build/*`, `style/*`, `deps/*`, `revert/*` | Anything | Nothing | Nothing |
| `dev` | Those kinds only | `preview` | A beta: `1.2.0-beta.N`, a GitHub prerelease, npm dist-tag `beta` |
| `main` | `dev` only | `production` | Stable: `1.2.0`, a GitHub release, npm dist-tag `latest` |

## 1. What holds it

Private repositories on GitHub's free plan cannot use branch protection, rulesets or environment branch rules: the
API answers `Upgrade to GitHub Pro`. So the workflows hold the flow themselves, with the `branches` action:

| Where | Check | When it fails |
|---|---|---|
| `ci.yml`, every pull request | The head may merge into the base (`merge-rules`) | In seconds, before anything installs, with where the branch should go instead |
| `deploy.yml`, `deploy-workers.yml` | The run's branch may deploy to the environment (`environment-branches`) | Before any token is used: a manual run on a feature branch cannot reach production |
| `rollback.yml` | The same | A production rollback runs from `main` only |
| `release.yml` | The branch has a channel (`channels`) | Before planning: only `dev` and `main` release |

What the workflows cannot stop on a free private repository: a direct `git push` to `main` or `dev`. The push itself
lands; what it cannot do is skip the checks, because the deploy on `main` runs them first and compares with the last
green deploy. Moving the organisation to GitHub Team adds server-side protection on top: require a pull request into
`main` and `dev`, and require the `ci` check.

## 2. Changing the rules

Every rule is an input with a default; a repository changes only what it needs:

```yaml
uses: buun-group/actions/.github/workflows/ci.yml@v1
with:
  merge-rules: |
    main: dev hotfix/*
    dev: feat/* fix/* chore/* docs/*
```

| Input | On | Default | Off |
|---|---|---|---|
| `merge-rules` | `ci.yml` | `main: dev`; `dev:` the conventional kinds | `-` |
| `environment-branches` | `deploy.yml`, `deploy-workers.yml`, `rollback.yml` | `production: main`; `preview: dev` | Never: an environment with no rule is refused |
| `channels` | `release.yml` | `main: stable`; `dev: beta` | Never |

A base with no merge rule accepts anything, so pull requests between feature branches still work.

## 3. Setting up a repository

1. Create `dev` from `main`: `git push origin main:dev`.
2. Make `dev` the default branch, so pull requests open against it.
3. Copy the starters: `ci.yml`, `deploy.yml`, `release.yml`, `rollback.yml`.
4. Create the `preview` and `production` environments, each with its own Cloudflare token.

## See also

| Doc | Why |
|---|---|
| [`branches/`](../branches/README.md) | The action and its rules |
| [Running only what changed](selective.md) | What each run checks |
| [Rolling back](rollback.md) | Code and data |
