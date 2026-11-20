# Standards

Runs the `.standards` gates (`ci.py`) at the commit the repository pins. The standards repository may be private, so
a GitHub App installed on it mints a token that reads that one repository. A repository without `.standards` passes.

```yaml
- uses: buun-group/actions/standards@v1
  with:
    repository: ${{ vars.STANDARDS_REPOSITORY }}
    app-client-id: ${{ vars.STANDARDS_APP_CLIENT_ID }}
    app-private-key: ${{ secrets.STANDARDS_APP_PRIVATE_KEY }}
```

## Standards

- `core/security.md`: a token for one repository, read only, minted per run.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Finds the pinned commit, mints the token, checks out the standards, runs the gates |
