// Works out what a run has to do from the files it changed: which named areas they touch, whether a change forces a
// full run, and whether nothing is left once ignored files are set aside.
//
// Run by action.yml with its inputs in the environment. Only Node's own modules.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ZERO_SHA = /^0+$/
const MAX_FILES = 3000

/** Files every package depends on: when one changes, selection cannot be trusted, so everything runs. */
export const DEFAULT_FULL_RUN = [
  '/pnpm-lock.yaml', '/package.json', '/pnpm-workspace.yaml', '/.nvmrc', '/turbo.json',
  '/tsconfig.json', '/tsconfig.base.json', '/vitest.config.*', '/vitest.workspace.*', '.github/workflows/**',
]
/** Files no check reads. */
export const DEFAULT_IGNORE = ['*.md', 'docs/**', '.changeset/**', '/LICENSE']

/** An input's globs: empty means the default, "-" means none, so a caller can turn a default off. */
export function globsOr(text, fallback) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return fallback
  if (trimmed === '-') return []
  return patternsOf(trimmed)
}

/**
 * A glob as a regular expression. `**` crosses folders, `*` and `?` do not, `{a,b}` is either. A pattern with no `/`
 * matches the file's name at any depth (`*.md`), as in .gitignore; one with a `/` matches from the repository root.
 */
export function globToRegExp(glob) {
  const anchored = glob.includes('/')
  const pattern = glob.replace(/^\/+/, '')
  let out = ''
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern[at]
    if (char === '*' && pattern[at + 1] === '*') {
      const slash = pattern[at + 2] === '/'
      out += slash ? '(?:.*/)?' : '.*'
      at += slash ? 2 : 1
    } else if (char === '*') out += '[^/]*'
    else if (char === '?') out += '[^/]'
    else if (char === '{') {
      const end = pattern.indexOf('}', at)
      if (end < 0) throw new Error(`unclosed { in "${glob}"`)
      out += `(?:${pattern.slice(at + 1, end).split(',').map(escape).join('|')})`
      at = end
    } else out += escape(char)
  }
  return new RegExp(anchored ? `^${out}$` : `(?:^|/)${out}$`)
}

const escape = (text) => text.replace(/[.+^$()|[\]\\]/g, '\\$&')

/** Patterns as matchers: `!pattern` excludes what the others include. */
export function matcher(patterns) {
  const include = patterns.filter((each) => !each.startsWith('!')).map(globToRegExp)
  const exclude = patterns.filter((each) => each.startsWith('!')).map((each) => globToRegExp(each.slice(1)))
  return (file) => include.some((re) => re.test(file)) && !exclude.some((re) => re.test(file))
}

/** Splits a list of globs given one or more per line, by spaces or commas; `#` starts a comment. */
export function patternsOf(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/#.*/, ''))
    .flatMap((line) => line.split(/[\s,]+/))
    .filter(Boolean)
}

/** Reads `name: glob glob !glob` lines. A name is letters, digits, - and _, so it is safe in fromJSON(...).name. */
export function filtersOf(text) {
  const filters = {}
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (line === '') continue
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) throw new Error(`filter line "${line}" is not "name: glob glob"`)
    const [, name, rest] = match
    filters[name] = [...(filters[name] ?? []), ...patternsOf(rest)]
  }
  return filters
}

/**
 * The plan for a run. `full` runs everything: there is no base to compare with, a file in fullRun changed, or too many
 * files changed to trust a selection. Every area is true in a full run, so `if: fromJSON(areas).api` stays correct.
 */
export function plan({ files, filters, fullRun, ignore, reason }) {
  const ignored = matcher(ignore)
  const relevant = files.filter((file) => !ignored(file))
  const forcing = files.filter(matcher(fullRun))
  const full = reason !== '' || forcing.length > 0 || files.length > MAX_FILES
  const areas = {}
  for (const [name, patterns] of Object.entries(filters)) {
    areas[name] = full || relevant.some(matcher(patterns))
  }
  return {
    full,
    why: reason || (forcing.length ? `${forcing[0]} changed` : files.length > MAX_FILES ? `more than ${MAX_FILES} files changed` : ''),
    none: !full && relevant.length === 0,
    areas,
    changed: Object.keys(areas).filter((name) => areas[name]),
    relevant,
  }
}

/** A workspace package's area name: the part after the scope, safe in fromJSON(...).name. */
export function areaNameOf(packageName) {
  const last = packageName.split('/').pop().replace(/[^\w-]/g, '-')
  return /^[A-Za-z]/.test(last) ? last : `p-${last}`
}

/** An ignore glob in the form pnpm's --changed-files-ignore-pattern takes: unanchored globs match at any depth. */
export function pnpmIgnoreOf(glob) {
  return glob.includes('/') ? glob.replace(/^\/+/, '') : `**/${glob}`
}

function pnpmPackages(args) {
  const out = execFileSync('pnpm', [...args, 'ls', '--depth', '-1', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  const start = out.indexOf('[')
  let list
  try {
    list = JSON.parse(start < 0 ? '[]' : out.slice(start))
  } catch {
    throw new Error(`pnpm ls did not answer JSON: ${out.slice(0, 200)}`)
  }
  const root = process.cwd()
  return list.filter((each) => typeof each?.name === 'string' && each.path !== root).map((each) => each.name)
}

/**
 * One area per workspace package, true when it changed or depends on one that did (pnpm's "...[base]"). Reads the
 * workspace's own graph, so no filter has to list which app uses which package.
 */
export function workspaceAreas(base, ignore, full) {
  const all = pnpmPackages(['-r'])
  const changed = full ? new Set(all) : new Set(pnpmPackages([`--filter=...[${base}]`, ...ignore.map((glob) => `--changed-files-ignore-pattern=${pnpmIgnoreOf(glob)}`)]))
  const areas = {}
  for (const name of all) {
    const area = areaNameOf(name)
    if (area in areas && !areas[area]) areas[area] = changed.has(name)
    else areas[area] = areas[area] || changed.has(name)
  }
  return areas
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}

/** The commit to compare with, or a reason there is none. */
async function baseOf(env) {
  const event = env.GITHUB_EVENT_NAME
  if (env.BASE === 'last-success') return lastSuccess(env)
  if (env.BASE) return { base: env.BASE, reason: '' }
  if (event === 'pull_request' || event === 'pull_request_target' || event === 'merge_group') {
    return { base: env.PR_BASE, reason: '' }
  }
  if (event === 'push' && env.BEFORE && !ZERO_SHA.test(env.BEFORE)) return { base: env.BEFORE, reason: '' }
  return { base: '', reason: `a ${event} run has nothing to compare with` }
}

/** The commit of this workflow's last successful run on this branch, so a failed deploy is retried by the next push. */
async function lastSuccess(env) {
  const workflow = (env.WORKFLOW_REF ?? '').split('@')[0].split('/').slice(2).join('/')
  const url = `${env.GITHUB_API_URL}/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${encodeURIComponent(workflow.replace(/^\.github\/workflows\//, ''))}/runs?branch=${encodeURIComponent(env.BRANCH)}&status=success&per_page=1`
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.TOKEN}`, accept: 'application/vnd.github+json' } })
  if (!response.ok) return { base: '', reason: `the last successful run could not be read (${response.status})` }
  const body = await response.json()
  const sha = body?.workflow_runs?.[0]?.head_sha
  return typeof sha === 'string' ? { base: sha, reason: '' } : { base: '', reason: 'this workflow has never succeeded on this branch' }
}

function changedFiles(base, head) {
  try {
    git(['cat-file', '-e', `${base}^{commit}`])
  } catch {
    return { files: [], reason: `${base.slice(0, 8)} is not in this checkout's history` }
  }
  // --no-renames: a move counts as a delete and an add, so both folders see it.
  const out = git(['diff', '--name-only', '--no-renames', base, head])
  return { files: out === '' ? [] : out.split('\n'), reason: '' }
}

function write(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

async function main(env) {
  const filters = filtersOf(env.FILTERS)
  let { base, reason } = await baseOf(env)
  let files = []
  if (reason === '' && env.SCOPE !== 'full') ({ files, reason } = changedFiles(base, env.HEAD))
  if (env.SCOPE === 'full') reason = 'scope is full'

  const ignore = globsOr(env.IGNORE, DEFAULT_IGNORE)
  const result = plan({ files, filters, fullRun: globsOr(env.FULL_RUN, DEFAULT_FULL_RUN), ignore, reason })
  const workspace = env.WORKSPACE === 'auto' ? (existsSync('pnpm-workspace.yaml') ? 'pnpm' : '') : env.WORKSPACE
  if (workspace === 'pnpm') {
    const packages = workspaceAreas(base, ignore, result.full)
    for (const [name, on] of Object.entries(packages)) {
      if (name in result.areas) throw new Error(`the filter "${name}" has the same name as a workspace package; rename the filter`)
      result.areas[name] = on
    }
    result.changed = Object.keys(result.areas).filter((name) => result.areas[name])
  } else if (workspace) {
    throw new Error(`workspace must be auto, pnpm or empty, not ${workspace}`)
  }
  const listPath = join(env.RUNNER_TEMP ?? '/tmp', 'changed-files.txt')
  writeFileSync(listPath, result.relevant.join('\n'))

  write('full', String(result.full))
  write('none', String(result.none))
  write('areas', JSON.stringify(result.areas))
  write('changed', JSON.stringify(result.changed))
  write('base', base)
  write('files', listPath)
  write('count', String(result.relevant.length))

  const summary = [
    '### Changes',
    result.full ? `Full run: ${result.why}.` : `${result.relevant.length} file(s) since \`${base.slice(0, 8)}\`.`,
    result.none ? 'Only ignored files changed: nothing to check.' : '',
    Object.keys(result.areas).length ? `| Area | Runs |\n|---|---|\n${Object.entries(result.areas).map(([name, on]) => `| ${name} | ${on ? 'yes' : 'no'} |`).join('\n')}` : '',
  ].filter(Boolean)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary.join('\n\n')}\n`)
  console.log(summary.join('\n'))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.env).catch((error) => {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  })
}
