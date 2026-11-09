# boat Sandbox

Run bb threads on on-demand [boat.dev](https://boat.dev) sandboxes. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/boat-sandboxes/SKILL.md` for the settings and commands.

This version starts a thread on a new boat sandbox and deletes the sandbox when
bb removes the machine. Stopping idle sandboxes and resuming them comes next.

## Requirements

A boat.dev account on a personal wallet with zero data retention off, and an
API key made with `boat api-key create bb --preset ci`. The bb project needs a
Git remote, and the bb server must be reachable from the internet (bb Connect).

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install boat-sandbox@ivan-anchev
```

## Develop

```sh
bb plugin install ./plugins/boat-sandbox   # once
bb plugin dev plugins/boat-sandbox         # rebuild and reload on save
npm test --workspace plugins/boat-sandbox
```
