# Branch policy

Checks the branch flow where GitHub's branch protection cannot (private repositories on a free plan): which branches
merge into which, which branch may act on which environment, and what a branch releases as. [Branches](../docs/branches.md)
explains the flow.

```yaml
- uses: buun-group/actions/branches@v1      # in a pull request: the head may merge into the base
- uses: buun-group/actions/branches@v1      # before a deploy: this branch may act on production
  with: { environment: production, check-merge: 'false' }
```

| Input | Default |
|---|---|
| `merge-rules` | `main: dev`; `dev: feat/* fix/* chore/* docs/* refactor/* perf/* test/* ci/* build/* style/* deps/* revert/* dependabot/* renovate/*` |
| `environment-branches` | `production: main`; `preview: dev` |
| `channels` | `main: stable`; `dev: beta` |

Outputs `channel` and `environment`: what the run's branch releases as and deploys to.

## Standards

- `core/git-commits.md`: branch kinds and the merge path.
- `packs/cloudflare/ci-cd.md`: branch to environment mapping enforced in CI.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Passes the rules and the run's refs to the script |
| `policy.mjs` | Rules, branch globs, merges, environments, channels |
| `policy.test.mjs` | The default flow allowed and refused, environments, channels |
