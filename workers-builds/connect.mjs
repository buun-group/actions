#!/usr/bin/env node
// Connects a repository's Workers to Cloudflare Workers Builds, so Cloudflare builds and deploys them on push, with
// nothing typed into the dashboard per Worker. Run from the repository's root:
//
//   node <actions>/workers-builds/connect.mjs                      plan every Worker, change nothing
//   node <actions>/workers-builds/connect.mjs --only docs          plan one
//   node <actions>/workers-builds/connect.mjs --only docs --apply  connect it
//
// It reads each Worker from its wrangler.jsonc (as deploy-workers does): its production and preview environments,
// its build:<env> scripts, and the workspace packages it uses, which become its watch paths. A Worker already
// connected is updated in place. A Worker whose package.json says "deploy": { "builds": false } is left alone.
//
// Needs, in the environment:
//   CLOUDFLARE_BUILDS_TOKEN  a USER token (an account token is refused) with Workers Builds Configuration: Edit and
//                          Workers Scripts: Read; CLOUDFLARE_API_TOKEN is used when it is unset. Without either, the
//                          plan prints with placeholders and nothing is called.
//   CLOUDFLARE_ACCOUNT_ID  the product's account
//   BUILD_TOKEN_UUID       optional: the build token to use; otherwise the account's first one
// and the gh CLI signed in, to read the repository's GitHub ids. The Cloudflare GitHub App must already be installed
// on the repository's organisation (dashboard, once per organisation).
//
// Only Node's own modules.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { packagesOf } from '../release/plan.mjs'
import { parseJsonc, workerFolders } from '../workers/plan.mjs'

const API = 'https://api.cloudflare.com/client/v4'
const CONFIGS = ['wrangler.jsonc', 'wrangler.json']
/** Changes to these at the root rebuild every Worker: the install would differ. */
const ROOT_WATCH = ['pnpm-lock.yaml', 'package.json', 'pnpm-workspace.yaml', '.nvmrc']

/** The workspace folders a Worker uses, through workspace: dependencies, followed all the way down. */
export function workspaceDependencies(manifest, packages) {
  const byName = new Map(packages.map((each) => [each.name, each]))
  const seen = new Set()
  const walk = (deps) => {
    for (const [name, spec] of Object.entries(deps ?? {})) {
      if (!String(spec).startsWith('workspace:') || seen.has(name) || !byName.has(name)) continue
      seen.add(name)
      walk(byName.get(name).dependencies)
    }
  }
  walk({ ...manifest.dependencies, ...manifest.devDependencies })
  return [...seen].map((name) => byName.get(name).dir).sort()
}

/** One environment's build and deploy commands for a Worker. */
export function commandsFor({ scripts, envs, environment, deploy }) {
  const install = 'pnpm install --frozen-lockfile'
  const build = scripts[`build:${environment}`] ? `pnpm run build:${environment}` : scripts.build ? 'pnpm run build' : ''
  const env = envs.includes(environment) ? ` --env ${environment}` : ''
  return {
    build_command: build ? `${install} && ${build}` : install,
    deploy_command: deploy === 'upload' ? `npx wrangler versions upload${env}` : `npx wrangler deploy${env}`,
  }
}

/** The request body Workers Builds takes for one Worker. */
export function bodyFor({ worker, github, buildToken, branch }) {
  const watch = {
    root_directory: worker.dir,
    path_includes: [...[worker.dir, ...worker.uses].map((dir) => `${dir}/*`), ...ROOT_WATCH],
    // Nothing excluded by default: in a docs Worker the Markdown is the product. "deploy": { "buildsExclude": [...] }.
    path_excludes: worker.exclude,
    build_caching_enabled: true,
    build_token_uuid: buildToken,
  }
  return {
    script_tag: worker.tag,
    git_repository: {
      provider_type: 'github',
      provider_account_id: String(github.ownerId),
      provider_account_name: github.owner,
      repo_id: String(github.repoId),
      repo_name: github.repo,
      branch,
    },
    production_settings: { ...watch, ...commandsFor({ ...worker, environment: 'production', deploy: 'deploy' }) },
    previews_enabled: worker.envs.includes('preview'),
    previews_base_config: { ...watch, ...commandsFor({ ...worker, environment: 'preview', deploy: 'upload' }) },
  }
}

/** Every Worker in the repository, as Workers Builds needs it. */
function workersOf(root) {
  const packages = packagesOf(root).map((each) => ({ ...each, dependencies: readManifest(join(root, each.dir)).dependencies }))
  return workerFolders(root).map((dir) => {
    const configName = CONFIGS.find((name) => existsSync(join(root, dir, name)))
    const config = parseJsonc(readFileSync(join(root, dir, configName), 'utf8'))
    const manifest = readManifest(join(root, dir))
    const envs = Object.keys(config.env ?? {})
    return {
      name: String(manifest.name ?? config.name).split('/').pop(),
      dir,
      envs,
      // Workers Builds connects the Worker that production deploys to.
      script: config.env?.production?.name ?? config.name,
      scripts: manifest.scripts ?? {},
      uses: workspaceDependencies(manifest, packages),
      skip: manifest.deploy?.builds === false,
      exclude: Array.isArray(manifest.deploy?.buildsExclude) ? manifest.deploy.buildsExclude.map(String) : [],
      tag: '<worker tag>',
    }
  })
}

function readManifest(dir) {
  const path = join(dir, 'package.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(`${path} is not JSON`)
  }
}

/** The repository's GitHub owner, name and ids, from origin and the gh CLI. */
function githubOf() {
  const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(origin)
  if (!match) throw new Error(`origin ${origin} is not a GitHub repository`)
  const [, owner, repo] = match
  const gh = (path) => execFileSync('gh', ['api', path, '--jq', '.id'], { encoding: 'utf8' }).trim()
  return { owner, repo, ownerId: gh(`users/${owner}`), repoId: gh(`repos/${owner}/${repo}`) }
}

async function cloudflare(method, path, token, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await response.json().catch(() => ({}))
  return { status: response.status, ok: response.ok && json.success !== false, json }
}

function argsOf(argv) {
  const only = []
  let apply = false
  let branch = 'main'
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--apply') apply = true
    else if (argv[at] === '--only') only.push(...String(argv[++at] ?? '').split(/[\s,]+/).filter(Boolean))
    else if (argv[at] === '--branch') branch = argv[++at]
    else throw new Error(`unknown argument ${argv[at]}`)
  }
  return { only, apply, branch }
}

async function main(argv, env) {
  const { only, apply, branch } = argsOf(argv)
  // A separate name, so the user token can sit beside the account token wrangler deploys with.
  const token = env.CLOUDFLARE_BUILDS_TOKEN || env.CLOUDFLARE_API_TOKEN
  const account = env.CLOUDFLARE_ACCOUNT_ID
  if (apply && (!token || !account)) throw new Error('--apply needs CLOUDFLARE_BUILDS_TOKEN (a user token) and CLOUDFLARE_ACCOUNT_ID')

  const all = workersOf('.')
  for (const name of only) if (!all.some((each) => each.name === name || each.dir === name)) throw new Error(`no Worker is named ${name}; found ${all.map((each) => each.name).join(', ')}`)
  const workers = all.filter((each) => !each.skip && (only.length === 0 || only.includes(each.name) || only.includes(each.dir)))
  const github = githubOf()

  let buildToken = env.BUILD_TOKEN_UUID || '<build token>'
  let scripts = []
  if (token && account) {
    const listed = await cloudflare('GET', `/accounts/${account}/workers/scripts`, token)
    if (!listed.ok) throw new Error(`listing Workers failed (${listed.status}): ${JSON.stringify(listed.json.errors ?? listed.json)}`)
    scripts = listed.json.result ?? []
    if (!env.BUILD_TOKEN_UUID) {
      const tokens = await cloudflare('GET', `/accounts/${account}/builds/tokens`, token)
      if (!tokens.ok) throw new Error(`reading build tokens failed (${tokens.status}): ${JSON.stringify(tokens.json.errors ?? tokens.json)}. Is the token a user token with Workers Builds Configuration: Edit?`)
      const first = (tokens.json.result ?? [])[0]
      if (!first) throw new Error('this account has no build token yet: connect any Worker once in the dashboard (Settings, Builds), which creates one')
      buildToken = first.build_token_uuid
    }
  }

  for (const worker of workers) {
    if (token && account) {
      const script = scripts.find((each) => each.id === worker.script)
      if (!script) {
        console.log(`\n${worker.name}: no Worker named ${worker.script} on this account yet; deploy it once, then connect it.`)
        continue
      }
      worker.tag = script.tag
    }
    const body = bodyFor({ worker, github, buildToken, branch })
    console.log(`\n=== ${worker.name} (${worker.dir}) -> ${worker.script}`)
    console.log(JSON.stringify(body, null, 2))
    if (!apply) continue

    const existing = await cloudflare('GET', `/accounts/${account}/builds/workers/${worker.tag}`, token)
    const done = existing.ok
      ? await cloudflare('PATCH', `/accounts/${account}/builds/workers/${worker.tag}`, token, body)
      : await cloudflare('POST', `/accounts/${account}/builds/workers`, token, body)
    if (!done.ok) throw new Error(`${worker.name}: Workers Builds refused it (${done.status}): ${JSON.stringify(done.json.errors ?? done.json)}`)
    console.log(`${worker.name}: ${existing.ok ? 'updated' : 'connected'}.`)
  }
  if (!apply) console.log('\nNothing was changed. Run again with --only <worker> --apply to connect.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).catch((error) => {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
  })
}
