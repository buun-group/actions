# Examples

Whole workflows written on these actions, to copy from. Names, paths and addresses are placeholders.

## Standards

- [Running only what changed](../docs/selective.md): the pattern every example follows.

## Contents

| Path | Purpose |
|---|---|
| [`monorepo/ci.yml`](monorepo/ci.yml) | A pnpm and turbo monorepo: package graph areas, a migrations area, docs pages kept in |
| [`monorepo/deploy.yml`](monorepo/deploy.yml) | Only the Workers changed since the last green deploy, with an order between two of them |
