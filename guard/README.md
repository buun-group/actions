# Guard

Fails when a commit in the push or pull request credits an AI tool: a `Co-Authored-By` line naming one, a
`Claude-Session` line, or a "Generated with" line. The organisations do not allow it. Needs a checkout with history.

```yaml
- uses: actions/checkout@<sha>
  with: { fetch-depth: 0, filter: blob:none, persist-credentials: false }
- uses: buun-group/actions/guard@v1
```

## Standards

- `core/git-commits.md`: commit messages and trailers.

## Contents

| Path | Purpose |
|---|---|
| `action.yml` | Reads the pull request's commits, or the push's, or the last `max-commits` for a new branch |
