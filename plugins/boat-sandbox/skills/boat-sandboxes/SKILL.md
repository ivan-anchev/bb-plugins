---
name: boat-sandboxes
description: The boat Sandbox plugin, which starts bb threads on new boat.dev sandboxes (`bb thread spawn --environment-provider boat-sandbox --machine-inputs '{"preset":"small"}'`, or boat Sandbox in the new-thread picker) and deletes them with `bb machine remove`. Covers its settings (API key, Stop after idle, Default size), presets, start limits, failed creates, and `bb boat status`. Use when a user sets up or uses boat.dev sandboxes for bb, or asks why one failed.
---

# boat Sandbox

boat Sandbox runs bb threads on boat.dev sandboxes. This version creates a
sandbox for a thread and deletes it when bb removes the machine; it does not
stop idle sandboxes or resume them yet.

## Start a thread on a sandbox

Pick **boat Sandbox** in the new-thread environment picker, or:

```sh
bb thread spawn --project <project-id> --environment-provider boat-sandbox \
  --machine-inputs '{"preset":"small"}' --prompt "…"
```

The thread's provisioning details show `Creating a small boat sandbox`, then
bb's own steps: machine enrollment, the daemon install, the clone and
`.bb-env-setup.sh`. A new sandbox is up in a few seconds and the whole
provisioning takes about 15 s.

- `--machine-inputs` takes `{"preset": "small" | "default" | "large" | "xlarge"}`,
  boat's sandbox types (2/4/8/16 vCPU). Leave it out (`{}`) for the
  **Default size** setting. Any other key is refused.
- The project needs a Git remote that bb knows about (`bb project show <id>`
  prints `gitRemoteUrl`). Without one, `boat-sandbox` is missing from
  `--environment-provider`, because bb clones the project from that remote.
- The bb server must be reachable from the internet (bb Connect), since the
  daemon on the sandbox connects back to it.
- The plugin installs no agent sign-in. Claude Code and Codex are
  preinstalled on boat's image but signed out, so a turn answers
  `Not logged in · Please run /login` until the machine has a login (for
  Claude Code, `CLAUDE_CODE_OAUTH_TOKEN` in `bb machine env`).

`bb machine list --all` shows the machine as `boat <sandbox-id>`, type
`ephemeral`, provider `boat-sandbox`. bb removes it once no live thread
needs it, or remove it yourself:

```sh
bb machine remove <host-id> --yes    # deletes the boat sandbox; boat answers 404 at once
```

## When a create fails

The thread's provisioning details show boat's own message, for example
`The 16 vCPU / 32 GB 'xlarge' Sandbox requires the $100/month Boat plan or
higher.` A refused create starts nothing and costs no start. A sandbox that
was created before a later step failed is deleted by bb's cleanup.

**Start limits.** boat counts every create against per-minute, per-hour and
per-day windows (`bb boat status` prints them) and refuses an over-limit start
with `429 rate_limited`. boat Sandbox waits out a per-minute window (up to 60 s)
once; a longer wait fails the create with the time the next start is allowed,
and later creates fail at once until then, without asking boat.

**Reloading the plugin mid-create** (`bb plugin reload boat-sandbox`) fails
that create; bb then deletes its sandbox. Start the thread again.

## What boat keeps

boat keeps every command's text and output for 90 days (`boat history
<sandbox-id>`). bb's enrollment secret reaches the sandbox on the command's
stdin, which boat's API does not offer, so the plugin writes it with boat's
Files API into a `0700` directory under `/tmp` and the command deletes it
before running. `boat history` lists `umask 077 && mkdir /tmp/bb-stdin.<uuid>`
and `{ rm -rf …; exec 'sh' '-c' …; } < /tmp/bb-stdin.<uuid>/in`, never the
file's content; checked live on 2026-11-08 across every history entry and its
stored output, and the sandbox's journal and `/var/log`.

Every sandbox is named `bb <thread-id>` and labelled `bb.boat/owner` (a random
id per bb server), `bb.boat/role=machine` and `bb.boat/key` (the thread id).
It is created with a 2-hour auto-stop. This version does not extend it yet, so
boat stops every sandbox 2 hours after its create, even mid-turn.

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
