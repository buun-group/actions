import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_FULL_RUN, filtersOf, globToRegExp, globsOr, matcher, patternsOf, plan } from './changes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('globs', () => {
  const cases = [
    ['apps/api/**', 'apps/api/src/index.ts', true],
    ['apps/api/**', 'apps/api-old/x.ts', false],
    ['apps/*/wrangler.jsonc', 'apps/site/wrangler.jsonc', true],
    ['apps/*/wrangler.jsonc', 'apps/site/nested/wrangler.jsonc', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/deep/page.md', true],
    ['docs/**', 'docs/a/b.md', true],
    ['**/*.test.ts', 'src/a.test.ts', true],
    ['**/*.test.ts', 'a.test.ts', true],
    ['src/**/*.{ts,tsx}', 'src/ui/Button.tsx', true],
    ['src/**/*.{ts,tsx}', 'src/ui/Button.css', false],
    ['vitest.config.*', 'vitest.config.ts', true],
    ['vitest.config.*', 'apps/x/vitest.config.ts', true],
    ['/package.json', 'apps/x/package.json', false],
    ['/package.json', 'package.json', true],
    ['a.b', 'axb', false],
  ]
  for (const [glob, file, expected] of cases) {
    it(`${glob} ${expected ? 'matches' : 'does not match'} ${file}`, () => assert.equal(globToRegExp(glob).test(file), expected))
  }

  it('excludes with !', () => {
    const inApi = matcher(['apps/api/**', '!**/*.md'])
    assert.equal(inApi('apps/api/src/a.ts'), true)
    assert.equal(inApi('apps/api/README.md'), false)
  })
})

describe('parsing', () => {
  it('reads globs split by spaces, commas and lines, without comments', () => {
    assert.deepEqual(patternsOf('a/** b/**, c\n  d # not e\n'), ['a/**', 'b/**', 'c', 'd'])
  })

  it('keeps the default for an empty input, none for "-", and the given globs otherwise', () => {
    assert.equal(globsOr('', DEFAULT_FULL_RUN), DEFAULT_FULL_RUN)
    assert.deepEqual(globsOr(' - ', DEFAULT_FULL_RUN), [])
    assert.deepEqual(globsOr('a/** b', DEFAULT_FULL_RUN), ['a/**', 'b'])
  })

  it('forces a full run for the root lockfile but not for a package.json inside an app', () => {
    const full = matcher(DEFAULT_FULL_RUN)
    assert.equal(full('pnpm-lock.yaml'), true)
    assert.equal(full('.github/workflows/ci.yml'), true)
    assert.equal(full('apps/site/package.json'), false)
  })

  it('reads areas, joining repeated names, and refuses a line that is not one', () => {
    assert.deepEqual(filtersOf('api: apps/api/** packages/core/**\nsite: apps/site/**\napi: shared/**'), {
      api: ['apps/api/**', 'packages/core/**', 'shared/**'],
      site: ['apps/site/**'],
    })
    assert.throws(() => filtersOf('apps/api/**'), /is not "name: glob glob"/)
    assert.throws(() => filtersOf('my area: x'), /is not "name: glob glob"/)
  })
})

describe('plan', () => {
  const filters = { api: ['apps/api/**', 'packages/core/**'], site: ['apps/site/**', 'packages/ui/**', 'packages/core/**'] }
  const base = { filters, fullRun: ['pnpm-lock.yaml'], ignore: ['*.md', 'docs/**'], reason: '' }

  it('turns on the areas a change touches, and only those', () => {
    const result = plan({ ...base, files: ['apps/site/src/a.ts'] })
    assert.deepEqual(result.areas, { api: false, site: true })
    assert.deepEqual(result.changed, ['site'])
    assert.equal(result.full, false)
  })

  it('turns on every area that shares a changed package', () => {
    assert.deepEqual(plan({ ...base, files: ['packages/core/x.ts'] }).changed, ['api', 'site'])
  })

  it('runs everything when a shared file changes, or there is no base', () => {
    const locked = plan({ ...base, files: ['pnpm-lock.yaml'] })
    assert.equal(locked.full, true)
    assert.deepEqual(locked.changed, ['api', 'site'])
    assert.match(locked.why, /pnpm-lock.yaml changed/)
    assert.equal(plan({ ...base, files: [], reason: 'a schedule run has nothing to compare with' }).full, true)
  })

  it('says none when only ignored files changed, and ignores them for areas', () => {
    const docs = plan({ ...base, files: ['README.md', 'docs/a.md', 'apps/api/NOTES.md'] })
    assert.equal(docs.none, true)
    assert.deepEqual(docs.changed, [])
  })
})

describe('a changes run in a real repository', () => {
  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'changes-'))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')
    const put = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    return { dir, git, put }
  }

  function run(dir, env) {
    const outputs = join(dir, '.outputs')
    writeFileSync(outputs, '')
    const done = spawnSync(process.execPath, [join(HERE, 'changes.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: '', RUNNER_TEMP: dir, FULL_RUN: 'pnpm-lock.yaml', IGNORE: '*.md', SCOPE: 'auto', BASE: '', ...env },
    })
    const out = Object.fromEntries(readFileSync(outputs, 'utf8').split('\n').filter(Boolean).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
    return { code: done.status, log: done.stdout + done.stderr, out }
  }

  it('compares a push with its previous commit, and lists the files', () => {
    const { dir, git, put } = repo()
    put('apps/api/a.ts', '1')
    put('apps/site/b.ts', '1')
    git('add', '-A')
    git('commit', '-qm', 'one')
    const before = git('rev-parse', 'HEAD')
    put('apps/api/a.ts', '2')
    git('mv', 'apps/site/b.ts', 'apps/api/b.ts')
    git('commit', '-qam', 'two')
    const head = git('rev-parse', 'HEAD')
    const result = run(dir, { GITHUB_EVENT_NAME: 'push', BEFORE: before, HEAD: head, FILTERS: 'api: apps/api/**\nsite: apps/site/**\nmail: apps/mail/**' })
    assert.equal(result.code, 0, result.log)
    // The move counts for both folders.
    assert.deepEqual(JSON.parse(result.out.areas), { api: true, site: true, mail: false })
    assert.equal(result.out.full, 'false')
    assert.deepEqual(readFileSync(result.out.files, 'utf8').split('\n').sort(), ['apps/api/a.ts', 'apps/api/b.ts', 'apps/site/b.ts'])
  })

  it('runs everything for a manual run, and for a base the checkout does not have', () => {
    const { dir, git, put } = repo()
    put('a.ts', '1')
    git('add', '-A')
    git('commit', '-qm', 'one')
    const head = git('rev-parse', 'HEAD')
    const manual = run(dir, { GITHUB_EVENT_NAME: 'workflow_dispatch', HEAD: head, FILTERS: 'api: apps/api/**' })
    assert.equal(manual.out.full, 'true')
    assert.deepEqual(JSON.parse(manual.out.areas), { api: true })
    const missing = run(dir, { GITHUB_EVENT_NAME: 'push', BEFORE: 'a'.repeat(40), HEAD: head, FILTERS: 'api: apps/api/**' })
    assert.equal(missing.out.full, 'true')
    assert.match(missing.log, /not in this checkout's history/)
  })
})
