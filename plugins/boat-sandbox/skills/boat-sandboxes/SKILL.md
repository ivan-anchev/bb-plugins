---
name: boat-sandboxes
description: The boat Sandbox plugin's settings (a boat.dev API key, Stop after idle, Default size) and its `bb boat status` command, which checks that the key works and shows the boat account id, wallet, zero-data-retention, and start budget. Use when a user sets up boat.dev sandboxes for bb or asks why boat Sandbox needs configuration.
---

# boat Sandbox

boat Sandbox will run bb threads on boat.dev sandboxes. This version stores
the boat API key and checks it; it does not create sandboxes yet.

## Settings

Settings → boat Sandbox, or `bb plugin config boat-sandbox`:

- **API key** (`apiKey`, secret). Make one with
  `boat api-key create bb --preset ci`; the `ci` preset covers every call the
  plugin makes and only deletes sandboxes the key created. The key is stored
  in a 0600 file, never shown again, and never printed by the plugin. Paste it
  in Settings rather than passing it to `bb plugin config … set`, which leaves
  it in shell history. Do not print or echo it.
- **Stop after idle (minutes)** (`idleMinutes`, default 15). A whole number
  from 0 to 1440; 0 never stops a sandbox for being idle.
- **Default size** (`defaultPreset`, default `default`). One of boat's sandbox
  types: `small`, `default`, `large`, `xlarge`.

bb reads the plugin's status only when the plugin loads, so after any fix (a
new key, a setting, the wallet, the network) run
`bb plugin reload boat-sandbox`. Until then `bb plugin list` keeps showing the
plugin as `needs-configuration`.

## `bb boat status`

Prints one line per fact and, for each problem, a `Fix:` line with the one
step that fixes it, ending with `bb plugin reload boat-sandbox`. Exit 0 when
boat Sandbox can run; exit 1 otherwise.

```text
API key: accepted by boat
Account: sandbox_… (octocat)
Wallet: personal
Zero data retention: off
Starts: 0/12 in the last minute, 0/60 in the last hour, 6/200 in the last day
```

The starts are boat's rolling start windows for the wallet a create would
bill. `; blocked: <reason>` follows them when boat lets no start run (for
example a trial account without a subscription).

boat Sandbox refuses two accounts, and says so in `bb boat status`:

- **Zero data retention on.** A stop deletes the sandbox, so bb could never
  resume one. Use a key from an account without it.
- **An organization wallet.** The key bills an organization, which boat
  Sandbox does not support yet. `boat org switch personal` moves the account's
  active wallet back to the personal one.

A rejected key (`401`/`403`) and an unreachable boat each print their own line
and fix.
