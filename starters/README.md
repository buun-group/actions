# Starters

Caller files a product copies into its `.github/workflows/`, keeping the file names. Each one is a few lines that
call a reusable workflow here at `@v1`; edit only the inputs marked in it.

## Standards

- `packs/cloudflare/ci-cd.md` and `packs/cloudflare/deployments.md`: branch to environment, one token per environment,
  smoke before promote, rollback.

## Contents

| Path | Purpose |
|---|---|
| [`ci.yml`](ci.yml) | Checks a pull request |
| [`deploy.yml`](deploy.yml) | Checks main, then deploys each Worker to production |
| [`preview.yml`](preview.yml) | Uploads a preview version per pull request and comments its address |
| [`rollback.yml`](rollback.yml) | Puts a Worker back on an earlier version from the Actions tab |
| [`release.yml`](release.yml) | release-please, then npm with trusted publishing; keep this file name |
| [`release-pypi.yml`](release-pypi.yml) | PyPI: build anywhere, publish in this file's own job; keep this file name |
