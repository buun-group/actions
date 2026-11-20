# Buun Group actions

One way to check, deploy, roll back and release every Buun Group product. Each product repository keeps two to four
short caller files; the steps live here, once.

## TL;DR

| You want | Use |
|---|---|
| Run only the checks, tests and deploys a change needs | [`changes`](changes/README.md) and [`tasks`](tasks/README.md), built into `ci.yml`: [running only what changed](docs/selective.md) |
| See it on a whole monorepo | [`examples/monorepo/`](examples/README.md) |
| Check a pull request | [`starters/ci.yml`](starters/ci.yml), which calls [`ci.yml`](.github/workflows/ci.yml) |
| Check main, then deploy it | [`starters/deploy.yml`](starters/deploy.yml), which calls `ci.yml` then [`deploy.yml`](.github/workflows/deploy.yml) |
| A preview version per pull request | [`starters/preview.yml`](starters/preview.yml) |
| Undo a deploy in one click | [`starters/rollback.yml`](starters/rollback.yml), which calls [`rollback.yml`](.github/workflows/rollback.yml) |
| Publish an npm package with provenance | [`starters/release.yml`](starters/release.yml), which calls [`release-npm.yml`](.github/workflows/release-npm.yml) |
| Publish to GitHub Packages | [`npm-publish`](npm-publish/action.yml) with `registry: github` |
| Tag and cut a GitHub release, from a version file or a given tag | [`github-release`](github-release/action.yml): notes from a changelog section or generated, files attached, safe to rerun |
| Publish a Python package to PyPI | [`starters/release-pypi.yml`](starters/release-pypi.yml): [`python-build`](python-build/action.yml), then [`pypi-publish`](pypi-publish/action.yml) in the product's own job |
| Mirror a folder to a public repository | [`mirror`](mirror/action.yml), with a GitHub App instead of a personal token |
| List an MCP server on the registry | [`mcp-registry`](mcp-registry/action.yml) |
| Put data back after a bad migration | `rollback.yml` with `d1-bookmark`: [rolling back](docs/rollback.md) |
| Let Cloudflare build a static site for free | [Workers Builds](docs/workers-builds.md) |
| Run for free | Set the variable `CI_RUNS_ON` to `["self-hosted","buun"]` on the organisation: [runners](docs/runners.md) |
| Move a product over | [Adopting](docs/adopting.md) |

## Trusted publishing, per registry

| Registry | How it trusts the run | Stored secret | Runner | Where the publish step must live |
|---|---|---|---|---|
| npm | OIDC trusted publisher, provenance from a public repository | None | GitHub's | Reusable workflow or the product's job (npm checks the calling workflow) |
| PyPI | OIDC trusted publisher, PEP 740 attestations | None | GitHub's | The product's own job: PyPI refuses reusable workflows |
| GitHub Packages | The job's own `GITHUB_TOKEN`, `packages: write` | None | Any | Anywhere |
| MCP registry | `github-oidc` for `io.github.<owner>/` names | None | GitHub's | Anywhere |
| MCP registry, own domain | `dns` or `http` proof | The domain key, in an environment | Any | Anywhere |
| A mirror repository | A GitHub App token for that one repository, minted per run | The app's private key, in an environment | Any | Anywhere |

## Why it is public

Products live in more than one GitHub organisation, and GitHub lets a private repository's workflows be called only
from its own organisation, so one shared set has to be public.
Nothing here is secret: every token stays in the calling repository's environments. Public repositories also run on
GitHub's runners for free, so this repository's own checks cost nothing.

## What saves minutes

| Rule | Where | Saves |
|---|---|---|
| Only the packages a change touches, and what uses them, are typechecked, tested and bundled | `changes`, `tasks`, `$CI_PNPM_FILTER`, `$CI_TURBO_AFFECTED` | A one-app pull request in an 11-package monorepo checks one app |
| One job for every check: guard, standards, lint, types, tests, audit, dry run | `ci.yml` | GitHub rounds each job up to a whole minute and every job installs again: four small workflows a push cost four installs and four rounded minutes |
| Pull requests are checked by `ci`, main by `deploy` | starters | A commit is checked once, not on push and again on pull request |
| A newer push cancels the run it replaces | starters | Abandoned runs stop |
| Changes only to Markdown, `docs/` or `.changeset/` run nothing | starters | Doc edits are free |
| `runs-on` reads `CI_RUNS_ON` | every workflow | A self-hosted runner costs no minutes |
| Guard and standards run before the install | `ci.yml` | A run they fail costs seconds |
| Large repositories are cloned without old file contents (`filter: blob:none`) | `ci.yml`, `release-npm.yml` | Checkout time |
| A canary's hold time is opt in | `deploy.yml` | A 10, 50, 100 rollout holds 30 minutes; keep it for self-hosted runners |

## Contents

| Path | Purpose |
|---|---|
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Reusable: every check, one job |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Reusable: one Worker to one environment, migrations first |
| [`.github/workflows/rollback.yml`](.github/workflows/rollback.yml) | Reusable: one Worker back to an earlier version |
| [`.github/workflows/release-npm.yml`](.github/workflows/release-npm.yml) | Reusable: one npm package, trusted publishing and provenance |
| [`.github/workflows/check.yml`](.github/workflows/check.yml) | This repository's own checks: actionlint, zizmor, tests |
| [`changes/`](changes/README.md) | Action: areas from the pnpm graph and globs, full run on shared files, nothing on ignored ones |
| [`tasks/`](tasks/README.md) | Action: run each `area: command` whose area changed, report every failure |
| [`examples/`](examples/README.md) | Whole workflows written on these actions |
| [`setup/`](setup/README.md) | Action: pnpm, Node, cache, install from the lockfile without scripts |
| [`guard/`](guard/README.md) | Action: refuse commits that credit an AI tool |
| [`standards/`](standards/README.md) | Action: the `.standards` gates at the pinned commit |
| [`d1-migrate/`](d1-migrate/README.md) | Action: a Time Travel bookmark, then pending D1 migrations, a step of their own |
| [`wrangler-deploy/`](wrangler-deploy/README.md) | Action: versions upload, smoke test, staged rollout, revert on failure |
| [`github-release/`](github-release/action.yml) | Action: a tag (from a version file or given) and a GitHub release with notes and files |
| [`npm-publish/`](npm-publish/action.yml) | Action: npm with trusted publishing and provenance, or GitHub Packages |
| [`python-build/`](python-build/action.yml) | Action: uv build, twine check, upload the dist; no OIDC token |
| [`pypi-publish/`](pypi-publish/action.yml) | Action: PyPI with trusted publishing and attestations, in the product's own job |
| [`mirror/`](mirror/action.yml) | Action: copy a folder to another repository, commit, tag, with an app token |
| [`mcp-registry/`](mcp-registry/action.yml) | Action: validate and list server.json on the MCP registry |
| [`starters/`](starters/README.md) | Caller files to copy into a product |
| [`docs/`](docs/README.md) | Adopting, runners, rolling back, Workers Builds |
| [`zizmor.yml`](zizmor.yml) | Which references zizmor lets go unpinned: only this repository's own |

## Standards

This repository follows the Buun Group coding standards. The ones that shape it:

- `packs/cloudflare/ci-cd.md` and `packs/cloudflare/deployments.md`: versions upload, smoke test on the version's own
  address, staged rollout, migrations apart from the deploy, one-click rollback, one token per environment.
- `core/supply-chain-provenance.md`: npm packages publish from CI with `--provenance`.
- `core/dependencies.md`: installs from the lockfile with `--ignore-scripts`; third-party actions pinned to a commit.

## Versions

Callers use `@v1`. A change that keeps every input working moves the `v1` tag; one that does not is `v2`. A release
here is a tag `v1.x.y` and the moved major tag:

```sh
git tag v1.0.1 && git tag -f v1 && git push origin v1.0.1 && git push -f origin v1
```

The reusable workflows call this repository's actions at `@v1` too, so a workflow and the actions it runs always come
from the same release line.

## See also

| Doc | Why |
|---|---|
| [Adopting](docs/adopting.md) | Moving a product's workflows over, and what to delete |
| [Runners](docs/runners.md) | Self-hosted runners per organisation, and what must stay on GitHub's |
| [GitHub: reusing workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) | `workflow_call`, `secrets: inherit`, limits |
| [npm: trusted publishers](https://docs.npmjs.com/trusted-publishers) | Why the publish job stays on GitHub's runners |
| [Cloudflare: gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/) | What `rollout` does |
