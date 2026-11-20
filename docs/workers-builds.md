# Workers Builds

Cloudflare's own CI: it clones the repository on each push, builds, and deploys, on Cloudflare's machines. No GitHub
minutes, no Cloudflare token in GitHub. This page says when to use it instead of `deploy.yml`, and how to set it up by
hand or by API.

## TL;DR

| Question | Answer |
|---|---|
| What does it cost? | Free plan: 3,000 build minutes a month per Cloudflare account, 1 build at a time. Paid ($5): 6,000, then $0.005 a minute, 6 at a time |
| Per what? | Per Cloudflare account. Each product has its own account, so each gets its own 3,000 |
| Limits on both plans | 20 minute build timeout, 8 GB memory, 20 GB disk, 64 build variables a Worker; 2 vCPU Free, 4 Paid |
| Use it for | Static sites and Workers without D1: docs, marketing sites, asset servers |
| Keep `deploy.yml` for | Workers with D1 migrations, smoke tests before traffic, a canary, or approval: the APIs |
| Automatable? | Yes, by the Cloudflare REST API. Not by wrangler: it has no command for Builds. The GitHub App is installed once per GitHub organisation in the dashboard |
| Never both | A Worker deployed by Workers Builds and by `deploy.yml` races itself. Pick one per Worker |

## 1. Which products fit

| Worker kind | Builds | `deploy.yml` |
|---|---|---|
| Docs, marketing, a static asset server | Yes | |
| A Worker with D1 (sign-in, APIs) | | Yes: migrations take a Time Travel bookmark first, and rollback can restore it |
| A Worker taking real traffic that needs a canary or approval | | Yes |

Workers Builds runs one build command and one deploy command. It has no step between upload and traffic for a smoke
test, no approval gate, and nothing that records a D1 bookmark, so the standards (`packs/cloudflare/ci-cd.md`,
section 9) keep it to simple projects.

## 2. By hand, once per Worker

1. Dashboard, the product's account: **Workers & Pages**, the Worker, **Settings**, **Builds**, **Connect**.
2. Pick GitHub. The first time on each GitHub organisation, it installs the Cloudflare Workers and Pages GitHub App:
   allow it only the repositories it builds.
3. Set:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `pnpm install --frozen-lockfile && pnpm build` (empty when wrangler bundles alone) |
| Deploy command | `npx wrangler deploy --env production` |
| Non-production branch deploy command | `npx wrangler versions upload --env preview` (a preview address per branch, no traffic) |
| Root directory | The Worker's folder in a monorepo, such as `apps/docs` |
| Build watch paths | Include `apps/docs/*` and the packages it uses; exclude `*.md` |
| Build variables | Build-time only. Runtime secrets stay `wrangler secret put` |

4. Remove the Worker's deploy job from GitHub, so only one thing deploys it.

## 3. By API

The API needs a **user** API token (an account token is refused) with *Workers Builds Configuration: Edit* and
*Workers Scripts: Read*. Base `https://api.cloudflare.com/client/v4`, header `Authorization: Bearer <token>`.

| Step | Call | Gives |
|---|---|---|
| 1 | `GET /accounts/{account_id}/workers/scripts` | The Worker's `tag` (where `id` is its name) |
| 2 | `GET https://api.github.com/orgs/{org}` and `GET https://api.github.com/repos/{org}/{repo}` | `provider_account_id` and `repo_id` (each `.id`) |
| 3 | `GET /accounts/{account_id}/builds/tokens` | `build_token_uuid` (made the first time a Worker is connected in the dashboard) |
| 4 | `POST /accounts/{account_id}/builds/workers` | The connection: body below |
| 5 | `GET /accounts/{account_id}/builds/workers/{worker_tag}` | Check it |
| Later | `PATCH /accounts/{account_id}/builds/workers/{worker_tag}` | Change only the fields sent |
| Build now | A deploy hook: `POST /accounts/{account_id}/builds/workers/{script_name}/deploy_hooks`, then `POST /workers/builds/deploy_hooks/{deploy_hook_uuid}` | A build of the production branch |
| Minutes left | `GET /accounts/{account_id}/builds/account/limits` | `has_reached_build_minutes_limit`, `build_minutes_refresh_on` |

```json
{
  "script_tag": "<worker tag>",
  "git_repository": {
    "provider_type": "github",
    "provider_account_id": "<org id>",
    "provider_account_name": "acme",
    "repo_id": "<repo id>",
    "repo_name": "docs",
    "branch": "main"
  },
  "production_settings": {
    "build_command": "pnpm install --frozen-lockfile && pnpm build",
    "deploy_command": "npx wrangler deploy --env production",
    "build_token_uuid": "<build token>",
    "root_directory": "/",
    "path_includes": ["*"],
    "path_excludes": ["*.md"],
    "build_caching_enabled": true
  },
  "previews_enabled": true,
  "previews_base_config": {
    "build_command": "pnpm install --frozen-lockfile && pnpm build",
    "deploy_command": "npx wrangler versions upload --env preview",
    "build_token_uuid": "<build token>",
    "root_directory": "/"
  }
}
```

Field names are Cloudflare's, from the Builds API guide. Cloudflare's reference also lists an older trigger model
(`/builds/triggers`, `/builds/repos/connections`); use the call above. Try it on one Worker by hand before scripting
the rest: the guide's response bodies are not all documented.

## See also

| Doc | Why |
|---|---|
| [Cloudflare: Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) | Settings, watch paths, previews |
| [Cloudflare: Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) | The calls above |
| [Cloudflare: limits and pricing](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) | The plan figures |
| [Adopting](adopting.md) | The GitHub side |
