import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { bodyFor, commandsFor, workspaceDependencies } from './connect.mjs'

describe('workspaceDependencies()', () => {
  it('follows workspace: dependencies all the way down, and ignores registry ones', () => {
    const packages = [
      { name: '@acme/ui', dir: 'packages/ui', dependencies: { '@acme/core': 'workspace:*', react: '19.0.0' } },
      { name: '@acme/core', dir: 'packages/core', dependencies: {} },
      { name: '@acme/crypto', dir: 'packages/crypto', dependencies: {} },
    ]
    assert.deepEqual(workspaceDependencies({ dependencies: { '@acme/ui': 'workspace:^', hono: '4.0.0' } }, packages), ['packages/core', 'packages/ui'])
  })
})

describe('commandsFor()', () => {
  it('installs and runs build:<environment>, falling back to build, then to install only', () => {
    assert.equal(commandsFor({ scripts: { 'build:preview': 'x' }, envs: ['preview'], environment: 'preview', deploy: 'upload' }).build_command, 'pnpm install --frozen-lockfile && pnpm run build:preview')
    assert.equal(commandsFor({ scripts: { build: 'x' }, envs: [], environment: 'production', deploy: 'deploy' }).build_command, 'pnpm install --frozen-lockfile && pnpm run build')
    assert.equal(commandsFor({ scripts: {}, envs: [], environment: 'production', deploy: 'deploy' }).build_command, 'pnpm install --frozen-lockfile')
  })

  it('deploys production and only uploads a preview version, naming the environment when the config has it', () => {
    assert.equal(commandsFor({ scripts: {}, envs: ['production'], environment: 'production', deploy: 'deploy' }).deploy_command, 'npx wrangler deploy --env production')
    assert.equal(commandsFor({ scripts: {}, envs: [], environment: 'preview', deploy: 'upload' }).deploy_command, 'npx wrangler versions upload')
  })
})

describe('bodyFor()', () => {
  const worker = { tag: 'tag1', dir: 'apps/docs', uses: ['packages/ui'], envs: ['production', 'preview'], scripts: { 'build:production': 'x' }, exclude: [] }
  const github = { owner: 'acme', ownerId: 1, repo: 'site', repoId: 2 }

  it('connects the repository and branch, watching the Worker, the packages it uses and the root install files', () => {
    const body = bodyFor({ worker, github, buildToken: 'bt', branch: 'main' })
    assert.deepEqual(body.git_repository, { provider_type: 'github', provider_account_id: '1', provider_account_name: 'acme', repo_id: '2', repo_name: 'site', branch: 'main' })
    assert.deepEqual(body.production_settings.path_includes, ['apps/docs/*', 'packages/ui/*', 'pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.nvmrc'])
    assert.deepEqual(body.production_settings.path_excludes, [])
    assert.equal(body.production_settings.root_directory, 'apps/docs')
    assert.equal(body.previews_enabled, true)
  })

  it('turns previews off for a Worker with no preview environment', () => {
    assert.equal(bodyFor({ worker: { ...worker, envs: ['production'] }, github, buildToken: 'bt', branch: 'main' }).previews_enabled, false)
  })
})
