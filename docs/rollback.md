# Rolling back code and data

What a rollback puts back, and how D1 Time Travel gives every migrating deploy a restore point.

## TL;DR

| Rule | Why |
|---|---|
| A deploy that applies a migration records a Time Travel bookmark first | One value restores data and schema to the moment before |
| A deploy with nothing to migrate records none | No restore point that would throw away later writes by mistake |
| Roll the code back first, then the data | The earlier code tolerates the newer, additive schema; newer code may not tolerate the older one |
| Restore data only when the deploy damaged it | A restore drops every write since the bookmark: sign-ups, payments, posts |
| A restore prints its own undo bookmark | A wrong restore can be undone the same way |
| Time Travel keeps 7 days on Workers Free, 30 on Paid | Past that, the bookmark is gone; export to R2 for longer |

## 1. Where the bookmark comes from

`deploy.yml` runs `d1-migrate`, which lists pending migrations and, when there are some, runs
`wrangler d1 time-travel info <db> --json` before `wrangler d1 migrations apply`. The bookmark is:

- in the run's summary, with the restore command written out;
- the `d1-bookmark` output of `deploy.yml`, for a caller that wants to store it.

## 2. Rolling back

From the Actions tab, run `rollback`:

| Case | Inputs |
|---|---|
| Code is wrong, data is fine | `environment`, nothing else: the Worker goes back to the version before |
| A migration or the new code damaged data | `environment` and `d1-bookmark` from the deploy's summary: code first, then data |
| Data only (the code is already fixed forward) | `d1-bookmark`, `code` off |
| Undo a restore | The undo bookmark the restore printed, `code` off |

Without a bookmark, `d1-timestamp` takes a moment instead (RFC3339 or Unix seconds), within the retention window.

## 3. What Time Travel does not cover

- **KV, R2, Durable Object storage and Queues.** Only D1. A deploy that changes their shape needs its own plan.
- **Writes after the bookmark.** They are gone from the database after a restore. If they matter, export them first:
  `wrangler d1 export <db> --remote --output=before-restore.sql`.
- **Longer than the window.** For a copy older than 7 or 30 days, a scheduled Worker exporting to R2 is the backup
  (`packs/cloudflare/deployments.md`, audit checklist).

## See also

| Doc | Why |
|---|---|
| [Cloudflare: D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | Bookmarks, restore, retention |
| [README](../README.md) | `rollback.yml` and `d1-migrate` |
