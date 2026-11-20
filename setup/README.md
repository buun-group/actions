# Setup

Installs pnpm (the version `packageManager` names) and Node (from `.nvmrc`), restores the pnpm store, and installs
the workspace from its lockfile with install scripts off.

```yaml
- uses: buun-group/actions/setup@v1
  with:
    rebuild: esbuild workerd # only when wrangler or the Workers test pool runs
```

## Standards

- `core/dependencies.md`: `--frozen-lockfile`, `--ignore-scripts`, third-party actions pinned to a commit.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Inputs: `working-directory`, `node-version`, `node-version-file`, `install`, `install-args`, `rebuild`, `registry-url`, `scope` |
