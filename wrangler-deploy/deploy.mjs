// Uploads a Worker version, smoke tests it on its own preview address, then sends traffic to it in the stages asked
// for, smoke testing between stages and putting the earlier version back if a stage fails.
//
// Run by action.yml with its inputs in the environment. Only Node's own modules, so it needs no install.

import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const FULL = 100
const MS_SECOND = 1000
const SECONDS_MINUTE = 60
const SMOKE_TRIES = 5
const SMOKE_WAIT_SECONDS = 3
const SMOKE_TIMEOUT_SECONDS = 15

/** JSON.parse that names what it was reading when the text is not JSON. No zod here: the script installs nothing. */
function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${what} is not JSON: ${text.slice(0, 200)}`)
  }
}

/** Reads the version wrangler uploaded from its output file, one JSON object per line. */
export function parseUpload(ndjson) {
  const entries = ndjson
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => parseJson(line, 'a line of the wrangler output file'))
  const upload = entries.findLast((entry) => entry.type === 'version-upload')
  if (upload === undefined || typeof upload.version_id !== 'string') {
    throw new Error('wrangler wrote no version-upload entry, so the version it uploaded is unknown')
  }
  return { versionId: upload.version_id, previewUrl: upload.preview_url ?? '' }
}

/** Turns "10,50,100" into [10, 50, 100]. Every stage is a whole percentage, rising, and the last is 100. */
export function stagesOf(text) {
  const stages = String(text)
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(Number)
  const rising = stages.every((stage, at) => Number.isInteger(stage) && stage > 0 && stage <= FULL && (at === 0 || stage > stages[at - 1]))
  if (stages.length === 0 || !rising || stages.at(-1) !== FULL) {
    throw new Error(`rollout "${text}" must be rising whole percentages ending at 100, such as "100" or "10,50,100"`)
  }
  return stages
}

/** The version specs for one stage: the new version at the stage's share, the earlier one with the rest. */
export function specsFor(newId, oldId, percentage) {
  if (percentage === FULL || oldId === '' || oldId === newId) return [`${newId}@${FULL}%`]
  return [`${newId}@${percentage}%`, `${oldId}@${FULL - percentage}%`]
}

/** The version taking most traffic now, or '' for a Worker never deployed. */
export function currentVersion(statusJson) {
  const status = parseJson(statusJson, 'wrangler deployments status')
  const versions = Array.isArray(status?.versions) ? status.versions : []
  const top = versions
    .filter((each) => typeof each?.version_id === 'string' && typeof each?.percentage === 'number')
    .sort((a, b) => b.percentage - a.percentage)[0]
  return top?.version_id ?? ''
}

/** The message every version carries: the commit, the pull request when there is one, and the commit's subject. */
export function messageFor({ sha, pr, subject }) {
  const parts = [`sha=${sha.slice(0, 8)}`]
  if (pr) parts.push(`pr=#${pr}`)
  if (subject) parts.push(subject)
  // Cloudflare keeps 100 characters of a version message.
  return parts.join(' ').slice(0, 100)
}

function wrangler(env, args, extraEnv = {}) {
  const [command, ...prefix] = env.WRANGLER.split(' ').filter(Boolean)
  const done = spawnSync(command, [...prefix, ...args], {
    cwd: env.WORKING_DIRECTORY,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  if (done.status !== 0) throw new Error(`wrangler ${args[0]} ${args[1] ?? ''} failed with exit code ${done.status}`)
  return done.stdout
}

const envArgs = (env) => (env.WRANGLER_ENV ? ['--env', env.WRANGLER_ENV] : [])

async function smoke(base, path) {
  const url = new URL(path, base).toString()
  for (let attempt = 1; attempt <= SMOKE_TRIES; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(SMOKE_TIMEOUT_SECONDS * MS_SECOND), redirect: 'manual' })
      if (response.status < 400) {
        console.log(`Smoke ${url}: ${response.status}`)
        return
      }
      console.log(`Smoke ${url}: ${response.status}, try ${attempt} of ${SMOKE_TRIES}`)
    } catch (error) {
      console.log(`Smoke ${url}: ${error.message}, try ${attempt} of ${SMOKE_TRIES}`)
    }
    await sleep(SMOKE_WAIT_SECONDS * MS_SECOND)
  }
  throw new Error(`smoke test failed: ${url} did not answer below 400`)
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function summary(line) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
}

async function main(env) {
  const stages = stagesOf(env.ROLLOUT)
  const message = messageFor({ sha: env.SHA, pr: env.PR, subject: env.SUBJECT })
  const outputFile = join(env.RUNNER_TEMP ?? '/tmp', `wrangler-${process.pid}.ndjson`)

  const oldId = stages.length > 1 ? currentVersion(wrangler(env, ['deployments', 'status', '--json', ...envArgs(env)])) : ''

  wrangler(env, ['versions', 'upload', ...envArgs(env), '--message', message], { WRANGLER_OUTPUT_FILE_PATH: outputFile })
  if (!existsSync(outputFile)) throw new Error('wrangler wrote no output file')
  const { versionId, previewUrl } = parseUpload(readFileSync(outputFile, 'utf8'))
  output('version-id', versionId)
  output('preview-url', previewUrl)
  summary(`### ${env.WRANGLER_ENV || 'default'}: version \`${versionId}\``)
  if (previewUrl) summary(`Preview: ${previewUrl}`)

  if (env.SMOKE_PATH) {
    if (previewUrl) await smoke(previewUrl, env.SMOKE_PATH)
    else console.log('::warning::This Worker has no preview address (preview_urls is off), so the version is smoke tested only once it takes traffic.')
  }
  if (env.UPLOAD_ONLY === 'true') return

  for (const [at, percentage] of stages.entries()) {
    wrangler(env, ['versions', 'deploy', ...specsFor(versionId, oldId, percentage), ...envArgs(env), '--message', message, '--yes'])
    summary(`- ${percentage}% of traffic on \`${versionId}\``)
    try {
      if (env.SMOKE_PATH && env.URL) await smoke(env.URL, env.SMOKE_PATH)
      if (at < stages.length - 1) {
        const minutes = Number(env.HOLD_MINUTES)
        console.log(`Holding at ${percentage}% for ${minutes} minutes.`)
        await sleep(minutes * SECONDS_MINUTE * MS_SECOND)
        if (env.SMOKE_PATH && env.URL) await smoke(env.URL, env.SMOKE_PATH)
      }
    } catch (error) {
      if (oldId !== '') {
        wrangler(env, ['versions', 'deploy', `${oldId}@${FULL}%`, ...envArgs(env), '--message', `revert: ${message}`.slice(0, 100), '--yes'])
        summary(`- Failed at ${percentage}%: all traffic back on \`${oldId}\``)
      }
      throw error
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.env).catch((error) => {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  })
}
