// Runs the commands whose area changed, one after another in one job, and reports every failure at the end rather
// than stopping at the first, so one run shows everything a pull request broke.
//
// Run by action.yml with its inputs in the environment. Only Node's own modules.

import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/**
 * Reads `area: command` lines. `area,other: command` runs when either changed; `*: command` always runs. A line
 * starting with spaces continues the command above it.
 */
export function tasksOf(text) {
  const tasks = []
  for (const raw of String(text ?? '').split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    if (/^\s/.test(raw) && tasks.length > 0) {
      tasks.at(-1).command += `\n${raw.trim()}`
      continue
    }
    const match = /^([*A-Za-z][\w,\s*-]*?)\s*:\s+(.+)$/.exec(raw.trim())
    if (!match) throw new Error(`task line "${raw.trim()}" is not "area: command"`)
    tasks.push({ areas: match[1].split(',').map((each) => each.trim()), command: match[2] })
  }
  return tasks
}

/** Which tasks run: those with `*`, those whose area is true, or all of them in a full run. */
export function selected(tasks, areas, full) {
  for (const task of tasks) {
    for (const area of task.areas) {
      if (area !== '*' && !(area in areas)) throw new Error(`task area "${area}" is not one of the filters (${Object.keys(areas).join(', ') || 'none'})`)
    }
  }
  return tasks.filter((task) => full || task.areas.some((area) => area === '*' || areas[area] === true))
}

function main(env) {
  const areas = env.AREAS ? JSON.parse(env.AREAS) : {}
  const tasks = tasksOf(env.TASKS)
  const run = selected(tasks, areas, env.FULL === 'true')
  const failed = []
  const lines = []
  for (const task of run) {
    const label = `${task.areas.join(',')}: ${task.command.split('\n')[0]}`
    console.log(`::group::${label}`)
    const started = Date.now()
    const done = spawnSync('bash', ['-euo', 'pipefail', '-c', task.command], { stdio: 'inherit', cwd: env.WORKING_DIRECTORY || '.' })
    const seconds = Math.round((Date.now() - started) / 1000)
    console.log('::endgroup::')
    lines.push(`| \`${task.command.split('\n')[0]}\` | ${task.areas.join(', ')} | ${done.status === 0 ? 'passed' : 'failed'} | ${seconds}s |`)
    if (done.status !== 0) {
      failed.push(label)
      console.log(`::error::${label} failed`)
    }
  }
  const skipped = tasks.length - run.length
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Tasks\n\n| Command | Area | Result | Time |\n|---|---|---|---|\n${lines.join('\n')}\n\n${skipped} skipped: their areas did not change.\n`)
  }
  if (failed.length > 0) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.env)
  } catch (error) {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  }
}
