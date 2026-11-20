# Runners

Where jobs run, and how to make them free.

## TL;DR

| Rule | Why |
|---|---|
| Every workflow takes its runner from `CI_RUNS_ON` | One variable moves a whole organisation between GitHub's runners and its own |
| Set `CI_RUNS_ON` on the organisation, not each repository | One place to change |
| A self-hosted runner serves one organisation | Each of the four organisations needs its own registration, which can be the same machine |
| npm publishing stays on GitHub's runners | npm does not accept trusted publishing from a self-hosted runner |
| A public repository never runs on a self-hosted runner | A fork's pull request would run its code on the machine |

## 1. The variable

`CI_RUNS_ON` is JSON: `"ubuntu-latest"` for GitHub's runners, `["self-hosted","buun"]` for runners with the label
`buun`. Unset, everything runs on `ubuntu-latest`.

```sh
gh variable set CI_RUNS_ON --org buun-group --body '["self-hosted","buun"]'
```

## 2. Registering a runner per organisation

A runner registered on an organisation serves only that organisation's repositories. One machine can run several
runner services, one per organisation, each in its own folder:

```sh
# Settings > Actions > Runners > New self-hosted runner on each organisation gives the token.
./config.sh --url https://github.com/buun-group --token <token> --labels buun --name buun-group-1 --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

In the runner group's settings, allow only private repositories, so a public one can never reach it.

## 3. What always stays on GitHub's runners

| Job | Why |
|---|---|
| `release.yml`, its release job | Trusted publishing (OIDC) works only on GitHub's runners |
| A public repository's jobs | Free there anyway, and unsafe on a self-hosted runner |
| A macOS or Windows build a machine cannot do | Those minutes cost 2x to 10x a Linux minute: keep them to tags |

## See also

| Doc | Why |
|---|---|
| [Adopting](adopting.md) | Moving a product over |
| [GitHub: self-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners) | Registering and securing a runner |
| [GitHub: billing for Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) | What a minute costs, and the rounding |
