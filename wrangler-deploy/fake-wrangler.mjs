// Stands in for wrangler in deploy.test.mjs: records each call, and answers the way wrangler does.
//
//   deployments status --json   prints the deployment in FAKE_STATUS
//   versions upload             writes a version-upload entry to WRANGLER_OUTPUT_FILE_PATH, preview at FAKE_PREVIEW_URL
//   versions deploy             succeeds
//
// Never shipped to a runner: the action runs the real wrangler.

import { appendFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
appendFileSync(process.env.FAKE_CALLS, `${JSON.stringify(args)}\n`)

if (args[0] === 'deployments' && args[1] === 'status') {
  process.stdout.write(process.env.FAKE_STATUS ?? '{"versions":[]}')
} else if (args[0] === 'versions' && args[1] === 'upload') {
  const entry = { type: 'version-upload', version: 1, version_id: 'new-version', preview_url: process.env.FAKE_PREVIEW_URL || undefined }
  writeFileSync(process.env.WRANGLER_OUTPUT_FILE_PATH, `${JSON.stringify(entry)}\n`)
}
