import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { branchMatches, channelOf, DEFAULT_CHANNELS, DEFAULT_ENVIRONMENTS, DEFAULT_MERGES, environmentAllowed, environmentOf, mergeAllowed, rulesOf } from './policy.mjs'

const merges = rulesOf(DEFAULT_MERGES)
const environments = rulesOf(DEFAULT_ENVIRONMENTS)
const channels = rulesOf(DEFAULT_CHANNELS)

describe('rulesOf()', () => {
  it('reads name: values lines, joining repeats, and "-" as no rules', () => {
    assert.deepEqual(rulesOf('main: dev hotfix/*\nmain: release/*\n# note'), { main: ['dev', 'hotfix/*', 'release/*'] })
    assert.deepEqual(rulesOf(' - '), {})
    assert.throws(() => rulesOf('main dev'), /is not "name: value value"/)
  })
})

describe('branchMatches()', () => {
  it('matches a glob across slashes, and nothing more', () => {
    assert.equal(branchMatches('feat/*', 'feat/login/page'), true)
    assert.equal(branchMatches('feat/*', 'feature/login'), false)
    assert.equal(branchMatches('dev', 'dev2'), false)
  })
})

describe('mergeAllowed()', () => {
  it('lets feature work into dev and only dev into main', () => {
    assert.equal(mergeAllowed(merges, 'dev', 'feat/billing').ok, true)
    assert.equal(mergeAllowed(merges, 'main', 'dev').ok, true)
  })

  it('refuses a feature branch straight into main, and says where it goes instead', () => {
    const refused = mergeAllowed(merges, 'main', 'feat/billing')
    assert.equal(refused.ok, false)
    assert.match(refused.why, /feat\/billing may not merge into main: only dev may\. Merge it into dev first/)
  })

  it('refuses a branch of no known kind into dev, and accepts anything into an unlisted base', () => {
    assert.equal(mergeAllowed(merges, 'dev', 'my-stuff').ok, false)
    assert.equal(mergeAllowed(merges, 'feat/big', 'feat/big-part').ok, true)
  })
})

describe('environmentAllowed()', () => {
  it('lets main act on production and dev on preview, and nothing else', () => {
    assert.equal(environmentAllowed(environments, 'production', 'main').ok, true)
    assert.equal(environmentAllowed(environments, 'preview', 'dev').ok, true)
    assert.equal(environmentAllowed(environments, 'production', 'dev').ok, false)
    assert.equal(environmentAllowed(environments, 'production', 'feat/x').ok, false)
  })

  it('refuses an environment with no rule rather than letting any branch at it', () => {
    assert.match(environmentAllowed(environments, 'staging', 'main').why, /staging has no branch rule/)
  })
})

describe('channelOf() and environmentOf()', () => {
  it('releases main as stable and dev as beta, and deploys each to its environment', () => {
    assert.equal(channelOf(channels, 'main'), 'stable')
    assert.equal(channelOf(channels, 'dev'), 'beta')
    assert.equal(channelOf(channels, 'feat/x'), '')
    assert.equal(environmentOf(environments, 'main'), 'production')
    assert.equal(environmentOf(environments, 'dev'), 'preview')
    assert.equal(environmentOf(environments, 'feat/x'), '')
  })
})
