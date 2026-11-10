# boat Sandbox

Experimental: it may break with a bb update.

Run bb threads on on-demand [boat.dev](https://boat.dev) sandboxes. A thread
gets a new sandbox when it starts; the sandbox stops after the thread has been
idle, resumes on the same disk when the thread gets a follow-up, and is deleted
when bb removes the machine. See `PLUGIN_OVERVIEW.md` for the user-facing
description and `skills/boat-sandboxes/SKILL.md` for the settings and commands.

## Requirements

A boat.dev account on a personal wallet with zero data retention off, and an
API key made with `boat api-key create bb --preset ci`. The bb project needs a
Git remote, and the bb server must be reachable from the internet (bb Connect).

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install boat-sandbox@ivan-anchev
```

## Use

Add the API key in Settings → boat Sandbox, then run `bb boat status` to check
the account. Pick **boat Sandbox** in the new-thread environment picker, or
start a thread from the CLI:

```sh
bb thread spawn --environment-provider boat-sandbox --machine-inputs '{"preset":"small"}' --prompt "…"
```

## Develop

```sh
bb plugin install ./plugins/boat-sandbox   # once
bb plugin dev plugins/boat-sandbox         # rebuild and reload on save
npm test --workspace plugins/boat-sandbox
```
