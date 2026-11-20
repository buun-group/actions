import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { currentVersion, messageFor, parseUpload, specsFor, stagesOf } from './deploy.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

describe('a deploy run, with wrangler faked', () => {
  /** The live address answers 200 until `broken` is set; the preview address always answers 200. */
  let server
  let base
  let broken = false

  before(async () => {
    server = createServer((request, response) => {
      response.statusCode = request.url.startsWith('/live') && broken ? 503 : 200
      response.end('ok')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => server.close())

  async function run(extra) {
    const dir = mkdtempSync(join(tmpdir(), 'deploy-'))
    const calls = join(dir, 'calls')
    const outputs = join(dir, 'outputs')
    writeFileSync(calls, '')
    writeFileSync(outputs, '')
    const env = {
      ...process.env,
      WORKING_DIRECTORY: dir,
      WRANGLER: `node ${join(HERE, 'fake-wrangler.mjs')}`,
      WRANGLER_ENV: 'production',
      ROLLOUT: '100',
      HOLD_MINUTES: '0',
      SMOKE_PATH: '',
      URL: '',
      UPLOAD_ONLY: 'false',
      SHA: '0123456789abcdef',
      PR: '',
      SUBJECT: 'feat: thing',
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      FAKE_CALLS: calls,
      FAKE_STATUS: JSON.stringify({ versions: [{ version_id: 'old-version', percentage: 100 }] }),
      FAKE_PREVIEW_URL: `${base}/preview/`,
      ...extra,
    }
    const child = spawn(process.execPath, [join(HERE, 'deploy.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stdout.on('data', (chunk) => (log += chunk))
    child.stderr.on('data', (chunk) => (log += chunk))
    const code = await new Promise((resolve) => child.on('close', resolve))
    const wranglerCalls = readFileSync(calls, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    return { code, log, calls: wranglerCalls, outputs: readFileSync(outputs, 'utf8') }
  }

  const deploys = (calls) => calls.filter((call) => call[0] === 'versions' && call[1] === 'deploy').map((call) => call.filter((arg) => arg.includes('@')))

  it('uploads with the environment and message, sends all traffic, and answers the version and preview address', async () => {
    const done = await run({ SMOKE_PATH: 'health' })
    assert.equal(done.code, 0, done.log)
    assert.deepEqual(done.calls[0], ['versions', 'upload', '--env', 'production', '--message', 'sha=01234567 feat: thing'])
    assert.deepEqual(deploys(done.calls), [['new-version@100%']])
    assert.match(done.outputs, /version-id=new-version/)
    assert.match(done.outputs, /preview-url=http:\/\/127\.0\.0\.1:\d+\/preview\//)
  })

  it('stages a canary against the version that had the traffic', async () => {
    const done = await run({ ROLLOUT: '10,50,100', SMOKE_PATH: 'live', URL: `${base}/` })
    assert.equal(done.code, 0, done.log)
    assert.deepEqual(deploys(done.calls), [['new-version@10%', 'old-version@90%'], ['new-version@50%', 'old-version@50%'], ['new-version@100%']])
  })

  it('puts all traffic back on the earlier version when a stage fails its smoke test', async () => {
    broken = true
    try {
      const done = await run({ ROLLOUT: '10,100', SMOKE_PATH: 'live', URL: `${base}/` })
      assert.equal(done.code, 1)
      assert.deepEqual(deploys(done.calls), [['new-version@10%', 'old-version@90%'], ['old-version@100%']])
      assert.match(done.log, /smoke test failed/)
    } finally {
      broken = false
    }
  })

  it('uploads only, sending no traffic, for a preview', async () => {
    const done = await run({ UPLOAD_ONLY: 'true', SMOKE_PATH: 'health' })
    assert.equal(done.code, 0, done.log)
    assert.deepEqual(deploys(done.calls), [])
  })
})

describe('parseUpload', () => {
  it('reads the last version-upload entry and its preview address', () => {
    const file = [
      JSON.stringify({ type: 'wrangler-session', version: 1 }),
      JSON.stringify({ type: 'version-upload', version: 1, version_id: 'aaa', preview_url: 'https://aaa-app.example.workers.dev' }),
      '',
    ].join('\n')
    assert.deepEqual(parseUpload(file), { versionId: 'aaa', previewUrl: 'https://aaa-app.example.workers.dev' })
  })

  it('answers no preview address when preview URLs are off', () => {
    assert.deepEqual(parseUpload(JSON.stringify({ type: 'version-upload', version_id: 'bbb' })), { versionId: 'bbb', previewUrl: '' })
  })

  it('refuses a file with no upload in it, or a line that is not JSON', () => {
    assert.throws(() => parseUpload(JSON.stringify({ type: 'deploy' })), /no version-upload entry/)
    assert.throws(() => parseUpload('Uploaded app'), /is not JSON/)
  })
})

describe('stagesOf', () => {
  it('reads one stage or several', () => {
    assert.deepEqual(stagesOf('100'), [100])
    assert.deepEqual(stagesOf(' 10, 50 ,100 '), [10, 50, 100])
  })

  it('refuses stages that fall, are not whole, or stop short of 100', () => {
    for (const bad of ['', '50', '50,10,100', '10.5,100', '0,100', '10,110', 'all']) {
      assert.throws(() => stagesOf(bad), /rising whole percentages/, bad)
    }
  })
})

describe('specsFor', () => {
  it('splits traffic with the earlier version until the last stage', () => {
    assert.deepEqual(specsFor('new', 'old', 10), ['new@10%', 'old@90%'])
    assert.deepEqual(specsFor('new', 'old', 100), ['new@100%'])
  })

  it('sends everything to the new version when there is no earlier one', () => {
    assert.deepEqual(specsFor('new', '', 10), ['new@100%'])
    assert.deepEqual(specsFor('new', 'new', 10), ['new@100%'])
  })
})

describe('currentVersion', () => {
  it('answers the version with the most traffic', () => {
    const status = JSON.stringify({ versions: [{ version_id: 'a', percentage: 10 }, { version_id: 'b', percentage: 90 }] })
    assert.equal(currentVersion(status), 'b')
  })

  it('answers nothing for a status with no versions, and refuses text that is not JSON', () => {
    assert.equal(currentVersion('{}'), '')
    assert.throws(() => currentVersion('The Worker has no deployments.'), /is not JSON/)
  })
})

describe('messageFor', () => {
  it('carries the short commit, the pull request and the subject, within 100 characters', () => {
    assert.equal(messageFor({ sha: '0123456789abcdef', pr: '42', subject: 'fix: pagination' }), 'sha=01234567 pr=#42 fix: pagination')
    assert.equal(messageFor({ sha: '0123456789abcdef', pr: '', subject: 'x'.repeat(200) }).length, 100)
  })
})
