import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import { addressOf, parseJsonc, plan, workerFolders, workerPlan } from './plan.mjs'

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'workers-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

const API_CONFIG = `{
  // the API
  "name": "api-dev",
  "main": "src/index.ts", /* inline */
  "d1_databases": [{ "binding": "DB", "migrations_dir": "./migrations" }],
  "env": {
    "production": {
      "name": "api-production",
      "routes": [{ "pattern": "*.example.com/x" }, { "pattern": "api.example.com", "custom_domain": true }],
      "d1_databases": [{ "binding": "DB", "database_name": "api-production", "migrations_dir": "./migrations" }],
    },
    "preview": { "routes": ["api-preview.example.com/*"] }
  }
}`

describe('reading wrangler config', () => {
  it('reads comments and trailing commas, and leaves // inside strings alone', () => {
    assert.deepEqual(parseJsonc('{ "url": "https://x//y", // c\n "a": [1, 2,], }'), { url: 'https://x//y', a: [1, 2] })
  })

  it('takes the first route without a wildcard host, as a custom domain or a pattern', () => {
    assert.equal(addressOf({ routes: [{ pattern: '*.x.com/*' }, { pattern: 'api.x.com', custom_domain: true }] }), 'https://api.x.com')
    assert.equal(addressOf({ routes: ['web.x.com/*'] }), 'https://web.x.com')
    assert.equal(addressOf({}), '')
  })
})

describe('finding Workers', () => {
  const files = {
    '.gitmodules': '[submodule "other"]\n\tpath = repositories/other\n\turl = x\n',
    'apps/api/wrangler.jsonc': API_CONFIG,
    'apps/api/migrations/0001.sql': 'create table x (id int);',
    'apps/api/package.json': { name: '@acme/api', deploy: { smokePath: '/health' } },
    'apps/web/wrangler.jsonc': '{ "name": "web", "assets": { "directory": "./dist" }, "env": { "production": { "routes": [{ "pattern": "example.com", "custom_domain": true }] } } }',
    'apps/web/package.json': { name: '@acme/web', scripts: { build: 'vite build', 'build:production': 'vite build --mode production' } },
    'apps/old/wrangler.jsonc': '{ "name": "old" }',
    'apps/old/package.json': { name: '@acme/old', deploy: { skip: true } },
    'repositories/other/wrangler.jsonc': '{ "name": "other" }',
    'apps/api/node_modules/dep/wrangler.jsonc': '{ "name": "dep" }',
  }

  it('finds each Worker folder, but not in dependencies or submodules', () => {
    assert.deepEqual(workerFolders(repo(files)).sort(), ['apps/api', 'apps/old', 'apps/web'])
  })

  it('reads the D1 binding with migrations, the address and the smoke path for the environment', () => {
    const root = repo(files)
    assert.deepEqual(workerPlan(root, 'apps/api', 'production'), {
      name: 'api', dir: 'apps/api', 'wrangler-env': 'production', 'd1-database': 'DB', url: 'https://api.example.com', 'smoke-path': '/health', 'build-command': '', skip: false,
    })
    assert.equal(workerPlan(root, 'apps/api', 'preview').url, 'https://api-preview.example.com')
    // The preview section declares no D1, and bindings are not inherited: nothing to migrate there.
    assert.equal(workerPlan(root, 'apps/api', 'preview')['d1-database'], '')
  })

  it('builds with build:<environment> when there is one, and smoke tests / by default', () => {
    const web = workerPlan(repo(files), 'apps/web', 'production')
    assert.equal(web['build-command'], 'pnpm run build:production')
    assert.equal(web['smoke-path'], '/')
  })

  it('uses the top level of the config for an environment it does not declare', () => {
    assert.equal(workerPlan(repo(files), 'apps/old', 'production')['wrangler-env'], '-')
  })
})

describe('choosing Workers', () => {
  const workers = [
    { name: 'api', dir: 'apps/api', skip: false },
    { name: 'web', dir: 'apps/web', skip: false },
    { name: 'old', dir: 'apps/old', skip: true },
  ]

  it('deploys the Workers whose area changed, all on a full run, never a skipped one', () => {
    assert.deepEqual(plan(workers, { areas: { api: true, web: false }, full: false, only: [] }).map((each) => each.name), ['api'])
    assert.deepEqual(plan(workers, { areas: {}, full: true, only: [] }).map((each) => each.name), ['api', 'web'])
  })

  it('deploys exactly the Workers named, changed or not', () => {
    assert.deepEqual(plan(workers, { areas: { api: false }, full: false, only: ['web'] }).map((each) => each.name), ['web'])
  })
})
