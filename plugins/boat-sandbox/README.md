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

- `server.ts`: composition root.
- `src/settings.ts`: the settings and `resolveSettings`, the one parse of them.
- `src/boat/wire.ts`: every boat JSON shape, parsed once with zod.
- `src/boat/client.ts`: the only HTTP to boat, and `BoatApiError`.
- `src/boat/access.ts`: whether the configured key can run sandboxes.
- `src/boat/sandbox.ts`: `Sandbox`, with boat's states collapsed to phases.
- `src/boat/start-gate.ts`: boat's start limit (`429 rate_limited`).
- `src/launch.ts`: the machine inputs (`template`, `environment`, `preset`)
  and `resolveLaunch`, the one rule that turns them into a launch.
- `src/catalog/`: boat's saved snapshots and environments as launch choices,
  and the `bb boat templates` tables.
- `src/ownership.ts`: the owner id, labels and the resource core persists.
- `src/executor.ts`: core's command channel over boat's commands API, with
  stdin staged as a file in a private directory.
- `src/instance-reset.ts`: on create, removes the bb machine state a template
  carried from another machine.
- `src/daemon-sign-ins.ts`: the systemd drop-in that loads boat's sign-ins
  into bb's daemon.
- `src/machine-provider.ts`: validate, create, suspend, resume, remove and
  keyed cleanup.
- `src/cli.ts`, `src/status.ts`: `bb boat status`, `templates` and
  `sandboxes`.
- `src/sign-ins.ts`, `src/settle.ts`: the Claude Code, Codex and AI proxy
  rows for one environment, and boat reads reported as `unknown (<reason>)`.
