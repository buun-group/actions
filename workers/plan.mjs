// Finds every Cloudflare Worker in a repository and what deploying it to an environment takes, with nothing
// configured per Worker: its folder (from its wrangler config), its area (its package name past the scope), the D1
// binding whose migrations to apply, the address to smoke test (its route for that environment), and its build
// script. A Worker deploys when its area changed, or every one on a full run.
//
// The one optional setting lives in the Worker's own package.json: "deploy": { "smokePath": "/health" }, and
// "deploy": { "skip": true } for a Worker this workflow must leave alone.
//
// Writes a matrix for the deploy job. Only Node's own modules.

import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CONFIGS = ['wrangler.jsonc', 'wrangler.json']
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist', 'build', '.turbo', 'coverage'])
const MAX_DEPTH = 4

/** JSON with comments and trailing commas, as wrangler.jsonc allows. Strings are left alone. */
export function parseJsonc(text) {
  let out = ''
  let inString = false
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (inString) {
      out += char
      if (char === '\\') { out += text[at + 1] ?? ''; at += 1 }
      else if (char === '"') inString = false
    } else if (char === '"') { inString = true; out += char }
    else if (char === '/' && text[at + 1] === '/') { while (at < text.length && text[at] !== '\n') at += 1; out += '\n' }
    else if (char === '/' && text[at + 1] === '*') { at = text.indexOf('*/', at + 2); if (at < 0) break; at += 1 }
    else out += char
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

/** Submodule paths from .gitmodules: each is another repository, which deploys itself. */
export function submodulesOf(root) {
  const file = join(root, '.gitmodules')
  if (!existsSync(file)) return new Set()
  return new Set([...readFileSync(file, 'utf8').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((match) => match[1]))
}

/** The folders holding a wrangler config, not inside dependencies, build output or a submodule. */
export function workerFolders(root, folder = '.', depth = 0, submodules = submodulesOf(root)) {
  if (submodules.has(folder)) return []
  const here = join(root, folder)
  const found = CONFIGS.some((name) => existsSync(join(here, name))) ? [folder] : []
  if (depth >= MAX_DEPTH) return found
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    found.push(...workerFolders(root, folder === '.' ? entry.name : `${folder}/${entry.name}`, depth + 1, submodules))
  }
  return found
}

/** The address a Worker serves in an environment: its first route without a wildcard host. */
export function addressOf(section) {
  const routes = section.routes ?? (section.route ? [section.route] : [])
  for (const route of routes) {
    const pattern = typeof route === 'string' ? route : route?.pattern
    if (typeof pattern !== 'string' || pattern.startsWith('*')) continue
    return `https://${pattern.replace(/\/\*$/, '').replace(/\/$/, '')}`
  }
  return ''
}

/** What deploying one Worker to one environment takes. */
export function workerPlan(root, folder, environment) {
  const configName = CONFIGS.find((name) => existsSync(join(root, folder, name)))
  const config = parseJsonc(readFileSync(join(root, folder, configName), 'utf8'))
  const section = environment && config.env?.[environment] ? config.env[environment] : config
  const manifestPath = join(root, folder, 'package.json')
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const scripts = manifest.scripts ?? {}
  const database = (section.d1_databases ?? []).find((each) => existsSync(join(root, folder, each.migrations_dir ?? 'migrations')))
  const url = addressOf(section)
  const build = scripts[`build:${environment}`] ? `pnpm run build:${environment}` : (config.assets || section.assets) && scripts.build ? 'pnpm run build' : ''
  const name = String(manifest.name ?? config.name ?? folder)
  return {
    name: name.split('/').pop(),
    dir: folder,
    'wrangler-env': environment && config.env?.[environment] ? environment : '-',
    'd1-database': database?.binding ?? '',
    url,
    'smoke-path': url ? (manifest.deploy?.smokePath ?? '/') : '',
    'build-command': build,
    skip: manifest.deploy?.skip === true,
  }
}

/** The Workers to deploy: those whose area changed (all on a full run), minus skipped ones, narrowed to `only`. */
export function plan(workers, { areas, full, only }) {
  return workers
    .filter((each) => !each.skip)
    .filter((each) => only.length === 0 || only.includes(each.name) || only.includes(each.dir))
    .filter((each) => full || only.length > 0 || areas[each.name] === true)
}

function main(env) {
  const root = env.WORKING_DIRECTORY || '.'
  let areas = {}
  try {
    areas = env.AREAS ? JSON.parse(env.AREAS) : {}
  } catch {
    throw new Error(`areas is not JSON: ${env.AREAS}`)
  }
  const full = env.FULL === 'true' || !env.AREAS
  const only = (env.ONLY ?? '').split(/[\s,]+/).filter((each) => each && each !== 'all')
  const workers = workerFolders(root).map((folder) => workerPlan(root, folder, env.ENVIRONMENT))
  const chosen = plan(workers, { areas, full, only }).map(({ skip, ...rest }) => rest)
  for (const name of only) {
    if (!workers.some((each) => each.name === name || each.dir === name)) throw new Error(`no Worker is named ${name}; found ${workers.map((each) => each.name).join(', ')}`)
  }

  const rows = workers.map((each) => `| ${each.name} | ${each.dir} | ${chosen.some((c) => c.dir === each.dir) ? 'yes' : each.skip ? 'skipped (deploy.skip)' : 'no change'} | ${each['d1-database'] || '-'} | ${each.url || '-'} |`)
  const summary = `### Deploy plan: ${env.ENVIRONMENT || 'default'}\n\n| Worker | Folder | Deploys | D1 | Address |\n|---|---|---|---|---|\n${rows.join('\n')}\n`
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: chosen })}\n`)
    appendFileSync(env.GITHUB_OUTPUT, `count=${chosen.length}\n`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.env)
  } catch (error) {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  }
}
