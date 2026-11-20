# Running only what changed

How a run decides what to check, test and deploy from the files it changed, and why that stays safe.

## TL;DR

| Level | Decides | How | Written by you |
|---|---|---|---|
| Workflow | Whether the workflow starts at all | `on.pull_request.paths` | Rarely: `changes` does it better inside the job |
| Area | Which tasks and deploy jobs run | `changes`: one area per pnpm package (from the workspace graph), plus `filters` for what is not a package | Only the non-package areas |
| Package | Which packages a command touches | `$CI_TURBO_AFFECTED`, `$CI_PNPM_FILTER` (changed packages and everything that uses them) | Nothing: the commands read the variable |
| Test file | Which tests inside a package | `$CI_VITEST_CHANGED` (vitest's import graph) | Nothing |
| Safety net | When selection is not trusted | A full run: lockfile, root config or workflow changed; manual run; `scope: full`; main compared with the last green deploy | `full-run` to add more |

## 1. Measured

| Repository, change | Before | With selection |
|---|---|---|
| An 11-package pnpm and turbo monorepo, five commits to its docs app | lint, typecheck and test of 11 packages, 12 vite builds for dry runs, 4 workflows | lint, then the docs app only: 1 of 11 packages |
| The same monorepo, fifteen commits to three apps | the same | 3 of 11, plus the packages they use |
| A single-package Worker of 39 test files, one leaf module changed | 39 test files | 35: almost everything imports two hub modules |
| The same Worker, its constants module changed | 39 | 39 |

What the numbers say:

- **Selecting packages is where the time goes.** A monorepo pull request usually touches one or two apps; every
  other app's typecheck, tests and bundle are skipped whole.
- **Selecting test files pays only in a package with a wide, shallow import graph.** The Worker's 584 tests run in
  8 seconds and most of them import a few hub modules, so vitest's `--changed` keeps nearly all of them. Use
  `$CI_VITEST_CHANGED` in a large package with independent parts, not by habit.
- **The slow part of AI-written test suites is usually not the count but the setup**: a fresh Miniflare, a D1, a
  browser per test. Selection skips whole packages of it; within one package, share the setup (`beforeAll`, one
  worker pool) before reaching for selection.

## 2. Writing it for a repository

```yaml
uses: buun-group/actions/.github/workflows/ci.yml@v1
with:
  # Areas the package graph cannot see. Packages need no line: each is an area already.
  filters: |
    migrations: apps/*/migrations/**
    openapi: apps/api/openapi/**
  # One command per line. "*" always runs; an area runs when it changed; every line runs in a full run.
  tasks: |
    *: pnpm lint
    *: pnpm turbo run typecheck test $CI_TURBO_AFFECTED
    *: pnpm -r $CI_PNPM_FILTER --if-present run check:deploy
    migrations: pnpm -r $CI_PNPM_FILTER exec sh -c 'if [ -d migrations ]; then wrangler d1 migrations apply DB --local; fi'
    openapi: pnpm --filter api run openapi:check
```

| Variable | Selective run | Full run |
|---|---|---|
| `CI_FULL` | `false` | `true` |
| `CI_BASE` | the commit compared with | empty, or the base |
| `CI_TURBO_AFFECTED` | `--affected` (turbo reads `TURBO_SCM_BASE`, set too) | empty |
| `CI_PNPM_FILTER` | `--filter=...[<base>]` | empty |
| `CI_VITEST_CHANGED` | `--changed=<base>` | empty |
| `CI_CHANGED_FILES` | a file of changed paths, one a line | the same |

In a deploy, gate each Worker's job on its area: `if: fromJSON(needs.ci.outputs.areas).api`.

## 3. Why it stays safe

| Risk | Answer |
|---|---|
| A shared file changes (lockfile, root tsconfig, vitest config, turbo.json, a workflow) and selection misses what it breaks | It is in `full-run`: everything runs, and the audit with it |
| A package changes and something that imports it breaks | pnpm's `...[base]` and turbo's `--affected` include every dependent, from the real graph |
| A file the graph cannot see (SQL, OpenAPI, a fixture) | Name it in `filters` and give it a task |
| A typo in a task's area silently skips it | `tasks` refuses an area no filter or package names |
| Selection skipped something on the pull request that breaks main | `deploy` checks main against the last green deploy (`base: last-success`) before it ships |
| A deploy failed and the next push changed something else | `last-success` still compares with the last green run, so the failed Worker deploys again |
| A run with nothing to compare (manual, schedule, a new branch, history rewritten) | Full run |
| More than 3,000 files changed | Full run |
| A required status check never reports because the workflow was path filtered | Path filtering happens inside the job: the check always reports, green when nothing applied |

## 4. When not to select

- **Before a release of something people pay for**: pass `scope: full` in the release workflow.
- **Once a week**, a scheduled full run on a self-hosted runner catches what no graph models (a flaky test, a clock,
  an upstream API).

## See also

| Doc | Why |
|---|---|
| [`examples/monorepo/`](../examples/monorepo/) | The pattern on a whole monorepo, pull requests and deploys |
| [`changes`](../changes/README.md) and [`tasks`](../tasks/README.md) | The two actions underneath |
| [turbo: `--affected`](https://turbo.build/repo/docs/reference/run#--affected) | Package selection with turbo |
| [pnpm: filtering](https://pnpm.io/filtering) | `...[<since>]` and `--changed-files-ignore-pattern` |
| [vitest: `--changed`](https://vitest.dev/guide/cli.html#changed) | Test file selection |
