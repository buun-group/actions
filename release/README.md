# Release plan

Lists what a repository can release, with nothing configured per package: every `package.json` with a name and a
version (the root, or each pnpm workspace package), its registry from `publishConfig.registry` (npm when unset), and
its tag. A version is planned when its tag does not exist. The [release workflow](../.github/workflows/release.yml)
uses it; it is usable alone for a matrix.

| Repository | Tag |
|---|---|
| One package | `v1.2.0` |
| A workspace | `<name past the scope>-v1.2.0`, such as `core-v0.7.3` |
| Anything else | `tag-format` with `{name}` and `{version}` |

Private packages are left out, or with `include-private` tagged and released without publishing.

## Standards

- `core/supply-chain-provenance.md`: published from CI, tagged at the commit that built it.
- `packs/monorepo/versioning.md`: one version per package, one tag per version.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Inputs: `tag-format`, `include-private`, `only`; outputs the matrix |
| `plan.mjs` | Finds the packages, reads the tags from the API, plans |
| `plan.test.mjs` | Workspace globs, registries, private packages, the plan |
