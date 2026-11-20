# Workers plan

Finds every Cloudflare Worker in a repository from its `wrangler.jsonc` (or `wrangler.json`), and reads what deploying
it to an environment takes, with nothing configured per Worker. The [deploy-workers
workflow](../.github/workflows/deploy-workers.yml) uses it; it is usable alone for a matrix.

| Read from | Becomes |
|---|---|
| The folder's `package.json` name past its scope | The Worker's name and its area (`@acme/api` is `api`) |
| `env.<environment>.d1_databases`, the first whose migrations folder exists | The D1 binding to bookmark and migrate |
| `env.<environment>.routes`, the first without a wildcard host | The address to smoke test |
| A `build:<environment>` script, or `build` when the Worker serves assets | The build command |
| `"deploy": { "smokePath": "/health" }` in the Worker's `package.json` | The smoke path (`/` otherwise) |
| `"deploy": { "skip": true }` | Left alone |

Folders inside `node_modules`, build output and git submodules are not searched: a submodule deploys from its own
repository. A Worker deploys when its area changed, every one on a full run, or exactly those named.

## Standards

- `packs/cloudflare/wrangler-config.md`: one config per Worker, environments that re-declare their bindings.
- `packs/cloudflare/deployments.md`: migrations before the code, smoke test before traffic.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Inputs: `environment`, `areas`, `full`, `only`; outputs the matrix |
| `plan.mjs` | Finds the Workers, reads each config, chooses |
| `plan.test.mjs` | Comments in JSONC, routes, D1, builds, submodules, the choice |
