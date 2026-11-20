# Wrangler deploy

Uploads a Worker version (`wrangler versions upload`), smoke tests it on its own preview address, then moves traffic to
it in the stages of `rollout`. Between stages it holds, smoke tests the live address, and on any failure puts all
traffic back on the version that had it.

```yaml
- uses: buun-group/actions/wrangler-deploy@v1
  with:
    working-directory: apps/api
    environment: production
    smoke-path: /health
    url: https://api.example.com
    rollout: '10,50,100'
```

| Input | Default | Means |
|---|---|---|
| `rollout` | `100` | Rising percentages ending at 100 |
| `hold-minutes` | `15` | Hold at each stage before the last |
| `smoke-path` | empty | A path that answers below 400 when healthy; empty skips smoke tests |
| `url` | empty | The live address, tested after each stage |
| `upload-only` | `false` | Upload and test, but send no traffic: a pull request's preview |

Each version's message is `sha=<8> pr=#<n> <subject>`, cut to Cloudflare's 100 characters.

## Standards

- `packs/cloudflare/deployments.md`: versions upload, smoke on the version's address, staged rollout, rollback.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Passes the inputs to the script as environment, never into the shell |
| `deploy.mjs` | Upload, smoke, rollout, revert. Node's own modules only |
| `deploy.test.mjs` | `node --test`: parsing, stages, splits, messages, and whole runs against a fake wrangler and a local server |
| `fake-wrangler.mjs` | The fake wrangler those runs use; records each call |
