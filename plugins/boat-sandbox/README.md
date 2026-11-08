# boat Sandbox

Run bb threads on on-demand [boat.dev](https://boat.dev) sandboxes. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/boat-sandboxes/SKILL.md` for the settings and commands.

This version stores and checks the boat API key (`bb boat status`); it creates
no sandboxes yet.

## Requirements

A boat.dev account on a personal wallet with zero data retention off, and an
API key made with `boat api-key create bb --preset ci`.

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
- `src/cli.ts`: `bb boat status`.
