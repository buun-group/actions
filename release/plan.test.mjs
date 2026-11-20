import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'

import { packagesOf, plan, tagFor, workspaceGlobs } from './plan.mjs'

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'release-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return dir
}

describe('tags', () => {
  it('names a tag from the name past its scope and the version', () => {
    assert.equal(tagFor('{name}-v{version}', '@acme/core', '0.7.2'), 'core-v0.7.2')
    assert.equal(tagFor('v{version}', '@acme/sdk', '1.0.0'), 'v1.0.0')
  })
})

describe('finding packages', () => {
  it('reads the workspace globs, quoted or not, and stops at the next key', () => {
    assert.deepEqual(workspaceGlobs("packages:\n  - apps/*\n  - 'packages/*'\n  - tools\n  - '!apps/old'\nonlyBuiltDependencies:\n  - esbuild\n"), ['apps/*', 'packages/*', 'tools', '!apps/old'])
  })

  it('lists every workspace package with its registry, and leaves out excluded folders', () => {
    const dir = repo({
      'pnpm-workspace.yaml': "packages:\n  - apps/*\n  - packages/*\n  - '!apps/old'\n",
      'package.json': { name: 'root', private: true },
      'apps/web/package.json': { name: '@acme/web', version: '0.0.0', private: true },
      'apps/old/package.json': { name: '@acme/old', version: '0.0.0' },
      'packages/core/package.json': { name: '@acme/core', version: '0.7.2', publishConfig: { registry: 'https://npm.pkg.github.com' } },
      'packages/sdk/package.json': { name: '@acme/sdk', version: '1.0.0' },
      'packages/notes/README.md': 'not a package',
    })
    const found = packagesOf(dir).map((each) => `${each.dir} ${each.name} ${each.private} ${each.registry}`).sort()
    assert.deepEqual(found, [
      'apps/web @acme/web true https://registry.npmjs.org',
      'packages/core @acme/core false https://npm.pkg.github.com',
      'packages/sdk @acme/sdk false https://registry.npmjs.org',
    ])
  })

  it('treats a repository without a workspace as one package at the root', () => {
    const dir = repo({ 'package.json': { name: 'tool', version: '2.1.0' } })
    assert.deepEqual(packagesOf(dir).map((each) => [each.dir, each.version]), [['.', '2.1.0']])
  })
})

describe('the plan', () => {
  const packages = [
    { dir: 'packages/core', name: '@acme/core', version: '0.7.2', private: false, registry: 'https://npm.pkg.github.com' },
    { dir: 'packages/sdk', name: '@acme/sdk', version: '1.0.0', private: false, registry: 'https://registry.npmjs.org' },
    { dir: 'apps/web', name: '@acme/web', version: '3.0.0', private: true, registry: 'https://registry.npmjs.org' },
  ]
  const base = { tagFormat: '{name}-v{version}', includePrivate: false, only: [] }

  it('releases only the versions whose tag is missing, each to its own registry', () => {
    const releases = plan(packages, { ...base, existingTags: new Set(['sdk-v1.0.0']) })
    assert.deepEqual(releases.map((each) => [each.tag, each.registryKind, each.publish]), [['core-v0.7.2', 'github', true]])
  })

  it('skips private packages, or tags them without publishing when asked', () => {
    assert.equal(plan(packages, { ...base, existingTags: new Set() }).some((each) => each.private), false)
    const withPrivate = plan(packages, { ...base, includePrivate: true, existingTags: new Set() })
    assert.deepEqual(withPrivate.find((each) => each.name === '@acme/web'), { ...packages[2], tag: 'web-v3.0.0', channel: 'stable', distTag: 'latest', publish: false, registryKind: 'npm' })
  })

  it('releases a beta of the next version of each package the push changed, under the dist-tag beta', () => {
    const releases = plan(packages, { ...base, existingTags: new Set(), channel: 'beta', run: '42', changed: ['packages/sdk/src/index.ts'] })
    assert.deepEqual(releases.map((each) => [each.tag, each.version, each.distTag]), [['sdk-v1.0.0-beta.42', '1.0.0-beta.42', 'beta']])
  })

  it('makes no beta of a version already released as stable', () => {
    const releases = plan(packages, { ...base, existingTags: new Set(['sdk-v1.0.0']), channel: 'beta', run: '43', changed: ['packages/sdk/x.ts'] })
    assert.deepEqual(releases, [])
  })

  it('treats every package as changed when the push has nothing to compare with', () => {
    assert.equal(plan(packages, { ...base, existingTags: new Set(), channel: 'beta', run: '1', changed: null }).length, 2)
  })

  it('refuses a branch that releases nothing', () => {
    assert.throws(() => plan(packages, { ...base, existingTags: new Set(), channel: '' }), /this branch releases nothing/)
  })

  it('considers only the packages named, by name or folder', () => {
    assert.deepEqual(plan(packages, { ...base, only: ['packages/sdk'], existingTags: new Set() }).map((each) => each.name), ['@acme/sdk'])
  })
})
