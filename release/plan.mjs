// Finds what a repository can release and which versions are not released yet, with nothing configured per
// package: every publishable package.json (the root, or each workspace package), its registry from publishConfig,
// and its tag from the tag format. A version is released when its tag does not exist.
//
// Writes a matrix for the release job. Only Node's own modules.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const NPM = 'https://registry.npmjs.org'

/** The tag for a package: {name} is the name past its scope, {version} the version. */
export function tagFor(format, name, version) {
  return format.replaceAll('{name}', name.split('/').pop()).replaceAll('{version}', version)
}

/** The workspace's package folders from pnpm-workspace.yaml's `packages:` globs (a trailing /* or /** only). */
export function workspaceGlobs(yaml) {
  const globs = []
  let inPackages = false
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/#.*/, '')
    if (/^packages\s*:/.test(line)) { inPackages = true; continue }
    if (inPackages && /^\S/.test(line)) break
    const item = /^\s*-\s*['"]?([^'"]+?)['"]?\s*$/.exec(line)
    if (inPackages && item) globs.push(item[1])
  }
  return globs
}

function foldersOf(root, glob) {
  if (glob.startsWith('!')) return []
  const base = glob.replace(/\/\*\*?$/, '')
  if (base === glob) return existsSync(join(root, glob, 'package.json')) ? [glob] : []
  const dir = join(root, base)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'package.json')))
    .map((entry) => `${base}/${entry.name}`)
}

/** Every package a release could publish: the workspace's when there is one, else the root. */
export function packagesOf(root) {
  const workspace = join(root, 'pnpm-workspace.yaml')
  const folders = existsSync(workspace) ? workspaceGlobs(readFileSync(workspace, 'utf8')).flatMap((glob) => foldersOf(root, glob)) : ['.']
  const excluded = existsSync(workspace) ? workspaceGlobs(readFileSync(workspace, 'utf8')).filter((g) => g.startsWith('!')).map((g) => g.slice(1)) : []
  return [...new Set(folders)]
    .filter((folder) => !excluded.includes(folder))
    .map((folder) => {
      const manifest = JSON.parse(readFileSync(join(root, folder, 'package.json'), 'utf8'))
      return { dir: folder, name: manifest.name, version: manifest.version, private: manifest.private === true, registry: manifest.publishConfig?.registry ?? NPM }
    })
    .filter((each) => typeof each.name === 'string' && typeof each.version === 'string')
}

/**
 * What to release: the packages whose tag is missing. Private ones only when includePrivate (tag and release, no
 * publish). A beta releases the next version, still untagged as stable, of each package the push changed, as
 * <version>-beta.<run>, under the npm dist-tag beta.
 */
export function plan(packages, { tagFormat, existingTags, includePrivate, only, channel = 'stable', run = '0', changed = null }) {
  if (channel !== 'stable' && channel !== 'beta') throw new Error(`this branch releases nothing (channel "${channel}"); releases come from main (stable) and dev (beta)`)
  return packages
    .filter((each) => (only.length === 0 || only.includes(each.name) || only.includes(each.dir)))
    .filter((each) => includePrivate || !each.private)
    .filter((each) => !existingTags.has(tagFor(tagFormat, each.name, each.version)))
    .filter((each) => channel === 'stable' || changed === null || changed.some((file) => each.dir === '.' || file.startsWith(`${each.dir}/`)))
    .map((each) => {
      const version = channel === 'beta' ? `${each.version}-beta.${run}` : each.version
      return {
        ...each,
        version,
        tag: tagFor(tagFormat, each.name, version),
        channel,
        distTag: channel === 'beta' ? 'beta' : 'latest',
        publish: !each.private,
        registryKind: each.registry.includes('npm.pkg.github.com') ? 'github' : 'npm',
      }
    })
    .filter((each) => !existingTags.has(each.tag))
}

/** The files a push changed, or null when there is nothing to compare with (then every package counts as changed). */
function changedFiles(before, head) {
  if (!before || /^0+$/.test(before)) return null
  try {
    execFileSync('git', ['cat-file', '-e', `${before}^{commit}`])
    return execFileSync('git', ['diff', '--name-only', before, head], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return null
  }
}

/** The repository's tags, from the API: no git credentials are kept on the runner for it. */
async function tagsOf(env) {
  if (!env.TOKEN || !env.GITHUB_REPOSITORY) {
    return execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  }
  const response = await fetch(`${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/git/matching-refs/tags`, {
    headers: { authorization: `Bearer ${env.TOKEN}`, accept: 'application/vnd.github+json' },
  })
  if (!response.ok) throw new Error(`the tags could not be read (${response.status})`)
  const refs = await response.json()
  if (!Array.isArray(refs)) throw new Error('the tags answer was not a list')
  return refs.map((each) => String(each?.ref ?? '').replace(/^refs\/tags\//, '')).filter(Boolean)
}

async function main(env) {
  const root = env.WORKING_DIRECTORY || '.'
  const packages = packagesOf(root)
  const single = !existsSync(join(root, 'pnpm-workspace.yaml'))
  const tagFormat = env.TAG_FORMAT || (single ? 'v{version}' : '{name}-v{version}')
  const tags = await tagsOf(env)
  const only = (env.ONLY ?? '').split(/[\s,]+/).filter(Boolean)
  const channel = env.CHANNEL ?? 'stable'
  const changed = channel === 'beta' ? changedFiles(env.BEFORE, env.HEAD) : null
  const releases = plan(packages, { tagFormat, existingTags: new Set(tags), includePrivate: env.INCLUDE_PRIVATE === 'true', only, channel, run: env.RUN_NUMBER ?? '0', changed })
    .map((each) => ({ ...each, dir: relative('.', join(root, each.dir)) || '.' }))

  const lines = releases.map((each) => `| ${each.name} | ${each.version} | ${each.tag} | ${each.publish ? `${each.registryKind}, ${each.distTag}` : 'tag only'} |`)
  const summary = releases.length
    ? `### Release plan: ${channel}\n\n| Package | Version | Tag | Publish to |\n|---|---|---|---|\n${lines.join('\n')}\n`
    : `### Release plan\n\nEvery version of ${packages.length} package(s) is already tagged. Bump a version to release it.\n`
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: releases })}\n`)
    appendFileSync(env.GITHUB_OUTPUT, `count=${releases.length}\n`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.env).catch((error) => {
    console.log(`::error::${error.message}`)
    process.exitCode = 1
  })
}
