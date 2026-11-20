// The branch flow, checked where GitHub's own branch protection cannot reach (private repositories on a free plan):
//
//   pull requests   which branches may merge into which: feat/* into dev, dev into main
//   environments    which branch may deploy, release or roll back to which environment: dev to preview, main to
//                   production
//   channel         what a branch releases as: dev a beta (1.2.0-beta.N), main a stable release
//
// Run by action.yml with its inputs in the environment. Only Node's own modules.

import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Branches merge only along this path unless a repository says otherwise. A base not listed accepts anything. */
export const DEFAULT_MERGES = `
main: dev
dev: feat/* fix/* chore/* docs/* refactor/* perf/* test/* ci/* build/* style/* deps/* revert/* dependabot/* renovate/*
`
/** Each environment, and the branches that may act on it. */
export const DEFAULT_ENVIRONMENTS = `
production: main
preview: dev
`
/** What each branch releases as. */
export const DEFAULT_CHANNELS = `
main: stable
dev: beta
`

/** `name: value value` lines into { name: [values] }. `-` alone means no rules at all. */
export function rulesOf(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '-') return {}
  const rules = {}
  for (const raw of trimmed.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    if (line === '') continue
    const match = /^([^\s:]+)\s*:\s*(.*)$/.exec(line)
    if (!match) throw new Error(`rule "${line}" is not "name: value value"`)
    rules[match[1]] = [...(rules[match[1]] ?? []), ...match[2].split(/[\s,]+/).filter(Boolean)]
  }
  return rules
}

/** A branch glob: `*` is any run of characters, including `/`. */
export function branchMatches(glob, branch) {
  const escaped = glob.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(branch)
}

/** Whether a pull request from `head` may merge into `base`. */
export function mergeAllowed(rules, base, head) {
  const allowed = rules[base]
  if (!allowed) return { ok: true, why: `${base} has no merge rule` }
  if (allowed.some((glob) => branchMatches(glob, head))) return { ok: true, why: `${head} may merge into ${base}` }
  return { ok: false, why: `${head} may not merge into ${base}: only ${allowed.join(', ')} may. Merge it into ${Object.keys(rules).find((each) => rules[each].some((glob) => branchMatches(glob, head))) ?? 'the branch its kind goes to'} first` }
}

/** Whether a run on `branch` may act on `environment`. An environment with no rule is refused: production must be named. */
export function environmentAllowed(rules, environment, branch) {
  const allowed = rules[environment]
  if (!allowed) return { ok: false, why: `${environment} has no branch rule; add "${environment}: <branch>" to environment-branches` }
  if (allowed.some((glob) => branchMatches(glob, branch))) return { ok: true, why: `${branch} may act on ${environment}` }
  return { ok: false, why: `${branch} may not act on ${environment}: only ${allowed.join(', ')} may` }
}

/** What a branch releases as, or '' for a branch that releases nothing. */
export function channelOf(rules, branch) {
  const match = Object.entries(rules).find(([glob]) => branchMatches(glob, branch))
  return match?.[1]?.[0] ?? ''
}

/** The environment a branch deploys to by default: the first environment whose rule names it. */
export function environmentOf(rules, branch) {
  return Object.entries(rules).find(([, globs]) => globs.some((glob) => branchMatches(glob, branch)))?.[0] ?? ''
}

function withDefault(text, fallback) {
  return String(text ?? '').trim() === '' ? fallback : text
}

function main(env) {
  const out = (name, value) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`)
  const summary = (line) => env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`)
  const merges = rulesOf(withDefault(env.MERGE_RULES, DEFAULT_MERGES))
  const environments = rulesOf(withDefault(env.ENVIRONMENT_RULES, DEFAULT_ENVIRONMENTS))
  const channels = rulesOf(withDefault(env.CHANNEL_RULES, DEFAULT_CHANNELS))
  // The branch a run acts for: a pull request's base for merges, the ref the run is on for everything else.
  const branch = env.REF_NAME

  const checks = []
  if (env.CHECK_MERGE === 'true' && env.BASE_REF) checks.push(mergeAllowed(merges, env.BASE_REF, env.HEAD_REF))
  if (env.ENVIRONMENT) checks.push(environmentAllowed(environments, env.ENVIRONMENT, branch))

  out('channel', channelOf(channels, branch))
  out('environment', environmentOf(environments, branch))
  for (const check of checks) {
    console.log(check.ok ? check.why : `::error::${check.why}`)
    summary(`- ${check.ok ? 'Allowed' : 'Refused'}: ${check.why}`)
  }
  if (checks.some((check) => !check.ok)) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.env)
  } catch (error) {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  }
}
