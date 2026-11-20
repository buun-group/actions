# Tasks

Runs the commands whose area changed, one after another in one job, and reports every failure at the end with how
long each took. In a full run every command runs.

```yaml
- uses: buun-group/actions/tasks@v1
  with:
    areas: ${{ steps.changes.outputs.areas }}
    full: ${{ steps.changes.outputs.full }}
    tasks: |
      *: pnpm lint
      api: pnpm --filter @acme/api test
      site, ui: pnpm --filter @acme/site build
        && pnpm --filter @acme/site check:deploy
```

A task naming an area that no filter or package has fails the run, so a typo never skips a check quietly.

## Standards

- `core/testing-strategy.md`: one run shows everything a change broke.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Passes the tasks, areas and full flag to the script |
| `tasks.mjs` | Parses `area: command` lines, selects, runs, summarises |
| `tasks.test.mjs` | Parsing, selection, the typo guard, and a run that keeps going after a failure |
