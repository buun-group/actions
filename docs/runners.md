# Runners

Where every job runs, chosen by the shared workflows themselves, and how to move an organisation onto its own
machines.

## TL;DR

| Rule | Why |
|---|---|
| Set `CI_RUNS_ON` once per organisation; no workflow names a runner | The shared workflows read the caller's variables, so one variable moves every repository |
| A public repository always runs on GitHub's runners | Free there, and a fork's pull request must never run on a staff machine |
| An npm publish always runs on GitHub's runners | npm accepts trusted publishing from nowhere else |
| A runner serves one organisation | Register one per organisation; one machine can hold several |
| Tools a job needs that a machine may lack are fetched or named | `gh` is fetched, pinned and checksummed; a missing `rsync` fails with how to install it |

## 1. How a job picks its runner

Every job in the shared workflows runs on the first of:

| Order | Source | Example |
|---|---|---|
| 1 | GitHub's runners, when the repository is public | Always `ubuntu-latest` |
| 2 | GitHub's runners, when the job publishes to npm | The release job of an npm package |
| 3 | The workflow's `runs-on` input, if the caller passes one | `runs-on: '["self-hosted","big"]'` for one heavy repository |
| 4 | The `CI_RUNS_ON` variable, the repository's or else the organisation's | `["self-hosted","buun"]` |
| 5 | GitHub's runners | `ubuntu-latest` |

So a repository does nothing: it calls the shared workflow, and its organisation's `CI_RUNS_ON` decides.

## 2. Moving an organisation onto its own machines

1. Register a runner on the organisation with the label `buun` (the staff developer tools do it in one command, or
   Settings, Actions, Runners, New runner).
2. In the organisation's runner group, allow private repositories only.
3. Set the variable:

   ```sh
   gh variable set CI_RUNS_ON --org <organisation> --body '["self-hosted","buun"]'
   ```

4. To go back to GitHub's runners, delete the variable. Nothing else changes.

Set the variable only once a runner is online: a job whose runner never appears waits in the queue for 24 hours
before GitHub cancels it.

## 3. What a self-hosted machine needs

| Tool | Needed by | If missing |
|---|---|---|
| `git`, `curl`, `bash`, `tar` | Everything | Install them |
| Node | Everything that builds | `setup-node` installs it |
| pnpm | pnpm repositories | `pnpm/action-setup` installs it |
| `gh` | `github-release` | Fetched for the job, pinned and checksummed |
| `rsync` | `mirror` | The step fails and says to install it |
| `python3` with `pip` or `pipx` | The optional semgrep gate | The gate is skipped |
| Docker | The PyPI publish action | PyPI publishes run on GitHub's runners in the starter |

A self-hosted machine keeps its pnpm store between runs, so installs are faster than on GitHub's runners, which start
empty.

## 4. What always runs on GitHub's runners

| Job | Why |
|---|---|
| An npm publish | Trusted publishing (OIDC) works only on GitHub's runners |
| The PyPI publish job in `release-pypi.yml` | It runs the PyPI publish action, which needs Docker and a clean machine |
| Any job of a public repository | Free there, and unsafe on a self-hosted runner |

## See also

| Doc | Why |
|---|---|
| [Adopting](adopting.md) | Moving a product over |
| [Branches](branches.md) | Which branch may deploy and release |
| [GitHub: self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners) | Registering and securing a runner |
| [GitHub: variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) | Organisation variables, and that a called workflow reads the caller's |
