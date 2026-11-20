# D1 migrate

Lists a Worker's pending D1 migrations and, when there are some, records a Time Travel bookmark and then applies
them on the remote database, as a step of its own before the deploy. A failed migration stops the run before any code
that needs it is live. The bookmark (output `bookmark`, and in the run's summary) restores data and schema to the
moment before: see [rolling back](../docs/rollback.md).

```yaml
- uses: buun-group/actions/d1-migrate@v1
  with:
    database: DB
    working-directory: apps/api
    environment: production
```

Migrations here must be additive (backward compatible). A removal ships after the code that stopped using it, in a
later deploy (`packs/cloudflare/deployments.md`, section 6).

## Standards

- `packs/cloudflare/deployments.md`: migrations apart from the deploy, and in which order.
- `packs/cloudflare/d1-read-budget.md`: a migration reads rows the daily allowance counts.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Inputs: `database`, `working-directory`, `environment`, `wrangler` |
