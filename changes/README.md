# Changes

Works out what a run must do from the files it changed. Every pnpm workspace package is an area (true when it, or a
package it uses, changed); `filters` adds areas for what is not a package. A shared file forces a full run, and a run
that changed only ignored files says so. [Running only what changed](../docs/selective.md) explains the design.

```yaml
- uses: actions/checkout@<sha>
  with: { fetch-depth: 0, filter: blob:none, persist-credentials: false }
- uses: buun-group/actions/setup@v1
  with: { install: 'false' }
- id: changes
  uses: buun-group/actions/changes@v1
  with:
    filters: |
      migrations: apps/*/migrations/**
- if: fromJSON(steps.changes.outputs.areas).api
  run: pnpm --filter @acme/api test
```

| Input | Default | Means |
|---|---|---|
| `workspace` | `auto` | One area per pnpm package when `pnpm-workspace.yaml` exists |
| `filters` | empty | `name: glob glob !glob` per line |
| `full-run` | lockfile, root configs, workflows | Any of these changing runs everything; `-` for none |
| `ignore` | `*.md docs/** .changeset/** /LICENSE` | Set aside first; `-` for none |
| `base` | the pull request's base, or the push's previous commit | `last-success`, or a commit |
| `scope` | `auto` | `full` runs everything |

| Output | Means |
|---|---|
| `areas` | `{"name": true}` JSON, for `fromJSON(...).name` |
| `changed` | The areas that run, as a JSON array |
| `full`, `none` | Everything runs; nothing does |
| `base`, `files`, `count` | What was compared, a file of the changed paths, how many |

## Standards

- `core/testing-strategy.md`: fast feedback; the full run before shipping is the net.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Passes the inputs and the event's commits to the script |
| `changes.mjs` | Globs, filters, the pnpm graph, the plan. Node's own modules only |
| `changes.test.mjs` | Globs, parsing, planning, and runs against a real git repository |
