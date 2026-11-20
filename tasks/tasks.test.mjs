import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { selected, tasksOf } from './tasks.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('tasks', () => {
  const text = ['*: pnpm lint', 'api: pnpm --filter api test', 'site, ui: pnpm --filter site build', '  && pnpm --filter site check:deploy', '# a comment'].join('\n')

  it('reads areas and commands, joining indented lines', () => {
    assert.deepEqual(tasksOf(text), [
      { areas: ['*'], command: 'pnpm lint' },
      { areas: ['api'], command: 'pnpm --filter api test' },
      { areas: ['site', 'ui'], command: 'pnpm --filter site build\n&& pnpm --filter site check:deploy' },
    ])
  })

  it('selects the always tasks and those whose area changed', () => {
    const tasks = tasksOf(text)
    const commands = (list) => list.map((task) => task.command.split('\n')[0])
    assert.deepEqual(commands(selected(tasks, { api: false, site: false, ui: true }, false)), ['pnpm lint', 'pnpm --filter site build'])
    assert.deepEqual(commands(selected(tasks, { api: false, site: false, ui: false }, true)).length, 3)
  })

  it('refuses an area no filter names, so a typo never silently skips a task', () => {
    assert.throws(() => selected(tasksOf('aip: pnpm test'), { api: true }, false), /"aip" is not one of the filters/)
  })

  it('runs every selected task even after one fails, then fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-'))
    const summary = join(dir, 'summary')
    writeFileSync(summary, '')
    const done = spawnSync(process.execPath, [join(HERE, 'tasks.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: summary, WORKING_DIRECTORY: dir, AREAS: '{"api":true,"site":false}', FULL: 'false', TASKS: '*: false\napi: echo ran-api > api.txt\nsite: echo ran-site > site.txt' },
    })
    assert.equal(done.status, 1)
    assert.equal(readFileSync(join(dir, 'api.txt'), 'utf8').trim(), 'ran-api')
    assert.match(readFileSync(summary, 'utf8'), /1 skipped/)
  })
})
