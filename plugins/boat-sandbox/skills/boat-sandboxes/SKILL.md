---
name: boat-sandboxes
description: The boat Sandbox plugin, which starts bb threads on new boat.dev sandboxes (`bb thread spawn --environment-provider boat-sandbox --machine-inputs '{"preset":"small"}'`, or boat Sandbox in the new-thread picker), stops them when idle, resumes them on a follow-up, and deletes them with `bb machine remove`. Covers its settings (API key, Stop after idle, Default size, Default template, Default environment), presets, templates (boat saved snapshots, `--machine-inputs '{"template":"<name>"}'`, `bb boat templates`), environments (`--machine-inputs '{"environment":"<name>"}'`, which decide the sign-ins, GitHub token and secrets a sandbox gets), Claude Code and Codex sign-ins from boat, the AI proxy, start limits, idle stops and resumes, the auto-stop lease, failed creates, drift between bb and boat, leaked sandboxes, `bb boat status`, `bb boat templates` and `bb boat sandboxes`. Use when a user sets up or uses boat.dev sandboxes for bb, or asks why one stopped, resumed, failed or was stopped as an orphan.
---

# boat Sandbox

boat Sandbox runs bb threads on boat.dev sandboxes. It creates a sandbox for a
thread, stops it when it has been idle, resumes the same sandbox when the
thread gets a follow-up, and deletes it when bb removes the machine.

## Start a thread on a sandbox

Pick **boat Sandbox** in the new-thread environment picker, or:

```sh
bb thread spawn --project <project-id> --environment-provider boat-sandbox \
  --machine-inputs '{"preset":"small"}' --prompt "…"
```

The thread's provisioning details show
`Creating a small boat sandbox from boat's stock image in environment base`, then
bb's own steps: machine enrollment, the daemon install, the clone and
`.bb-env-setup.sh`. A new sandbox is up in a few seconds and the whole
provisioning takes about 15 s.

- `--machine-inputs` takes `{"preset": "small" | "default" | "large" | "xlarge"}`,
  boat's sandbox types (2/4/8/16 vCPU); `{"template": "<name>"}`, a boat
  saved snapshot to start from (see Templates), or `{"template": null}` for
  boat's stock image; and `{"environment": "<name>"}`, the boat environment
  the sandbox starts in (see Environments). A key left out takes its setting
  (**Default size**, **Default template**, **Default environment**). Any other
  key is refused. `bb boat templates` prints every name with its
  `--machine-inputs`.
- The project needs a Git remote that bb knows about (`bb project show <id>`
  prints `gitRemoteUrl`). Without one, `boat-sandbox` is missing from
  `--environment-provider`, because bb clones the project from that remote.
- The bb server must be reachable from the internet (bb Connect), since the
  daemon on the sandbox connects back to it.
- Claude Code and Codex sign in from boat, with what the sandbox's
  environment passes (see Sign-ins from boat). Without a sign-in, a turn
  answers `Not logged in · Please run /login`.

`bb machine list --all` shows the machine as `boat <sandbox-id>`, type
`ephemeral`, provider `boat-sandbox`. bb removes it once no live thread
needs it, or remove it yourself:

```sh
bb machine remove <host-id> --yes    # deletes the boat sandbox; boat answers 404 at once
```

## Environments

A boat **environment** decides what of your boat account a sandbox gets: the
Claude Code and Codex sign-ins, the GitHub token, and the environment's
variables and secret files. Every boat account has `base`, boat's default
environment. You make and change environments on boat; the plugin lists them
and starts each thread sandbox in one.

```sh
boat env list                               # every environment; boat's default is marked
boat env info base                          # its toggles, variables, secret files and repositories
bb thread spawn --project <project-id> --environment-provider boat-sandbox \
  --machine-inputs '{"environment":"base","preset":"small"}' --prompt "…"
```

An environment holds:

- **Toggles**, changed with `boat env set <name> --<toggle> true|false`:
  `--agents-credentials` (the Claude Code and Codex sign-ins), `--github`
  (the GitHub token and the environment's repositories), `--secrets` (its
  variables and secret files) and `--boat-credentials` (boat's CLI token in
  the sandbox, see below).
- **Safe for third parties** (`--safe-for-third-parties true`): passes
  nothing, whatever the toggles say, like `boat new --no-env`. With
  `--proxy-ai-credentials true` the agents still sign in, through boat's AI
  proxy placeholders; real keys never enter the sandbox.
- **Variables, secret files and repositories** (`boat env set-var`,
  `set-file`, `add-repo`). A repository is cloned to `/home/user/<name>` in
  every sandbox and its setup script runs at every start, resume included.
- **A credential profile** (`--credential-profile`): which of your AI
  credentials the agents get; the default is your own default profile.

Every change makes a new version of the environment. New sandboxes take the
latest version. A sandbox keeps the version it started with, so a running
thread sandbox does not see the change until `boat env upgrade <name>`
pushes it (to live sandboxes at once, stopped ones at resume).

A thread that names no environment gets the **Default environment** setting;
empty is boat's default environment. Every create names its environment to
boat, and the create fails if boat attached another one:
`boat started sandbox bx_… without environment base (it holds none), so it would not get that environment's sign-ins.`
An unknown name is refused at spawn, before bb records the thread:
``boat has no environment "nope". Run `bb boat templates` to list them.``

## Templates

A template is a boat **saved snapshot**: a frozen copy of a sandbox's disk,
saved under a name on your boat account. You make and manage them on boat;
the plugin lists them and starts thread sandboxes from them.

```sh
boat snapshot <sandbox-id> node-tools       # save any boat sandbox's disk as "node-tools"
bb boat templates                           # every template, with the --machine-inputs for each
bb thread spawn --project <project-id> --environment-provider boat-sandbox \
  --machine-inputs '{"template":"node-tools","preset":"small"}' --prompt "…"
boat snapshot rm node-tools                 # delete it on boat
```

- Install your tools on a sandbox (a thread sandbox, or `boat new`), then
  save it. The sandbox can keep running; boat takes a fresh snapshot first.
  Names are 1–63 lowercase letters, digits and dashes.
- A template holds whatever was on that disk, logins and tokens included. The
  plugin does not inspect it. Save from a sandbox you would hand to every
  thread that uses the template.
- A thread that names no template gets the **Default template** setting;
  empty is boat's stock image. `{"template":null}` asks for the stock image
  even when a Default template is set.
- An unknown name, or a template boat is still saving or failed to save, is
  refused at spawn, before bb records the thread, for example
  ``No saved snapshot "nope" on this boat account. Run `bb boat templates` to list them.``
  Names come from the API key's boat account, so a template on another
  account is unknown here.
- **Saved from a bb thread sandbox.** Such a disk carries that machine's bb
  identity: `~/.bb-machines` (its host key and checkouts) and its
  `bb-host-daemon-*.service` unit, plus `~/.local/bin/bb` when that is a
  symlink into `~/.bb-machines`. On create (never on
  resume), before bb enrolls the new sandbox, the plugin stops and removes
  them, and the provisioning details say so:
  `Removed the bb machine state template node-tools carried from another machine: ~/.config/systemd/user/bb-host-daemon-….service, ~/.bb-machines`.
  It removes nothing until systemd confirms the old daemon is stopped. When it
  cannot, the create fails with
  `Could not remove the old bb machine state on sandbox bx_… (exit 1): … did not stop (state: active)`
  (or systemd's own error) and bb deletes the sandbox.
  It records the create in `~/.local/state/bb-boat/instance-key`, so a retried
  create of the same thread never removes what it already enrolled. It leaves
  everything else on the disk alone. The old daemon starts at boot and runs
  for about a second before that. To keep a template clean, stop and disable
  bb's daemon on the sandbox before you save one you will reuse:
  `systemctl --user disable --now $(cd ~/.config/systemd/user && ls bb-host-daemon-*.service)`.
- **Saved from a `--no-env` sandbox** (`boat new --no-env`). boat makes every
  sandbox from it no-env too, even though the create names an environment
  (boat then reports that environment but attaches none of its logins;
  checked live on 2026-11-09), so it would get no sign-ins. The create fails
  with `… as a no-env sandbox, so it would get no sign-ins …` and bb deletes
  the sandbox. Save the template again from a sandbox in an environment.
- Any size can start from any template; the template's own size is only shown.
- boat's trial accounts cannot save snapshots; `bb boat templates` then lists
  only the stock image.

## Sign-ins from boat

Thread sandboxes take their sign-ins from the boat environment they start
in; the plugin writes no credentials itself. With **agent credentials** on,
boat writes the sign-ins connected under
[Agents & Proxying](https://boat.dev/dashboard?tab=agents) (a Claude or
ChatGPT subscription, or an Anthropic or OpenAI API key) to
`/run/ascii-secrets/env.sh` (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, the `CHATGPT_*` tokens) and `~/.codex/auth.json`, fresh at
every start and resume. With **GitHub** on, it adds `GITHUB_TOKEN`; with
**secrets** on, the environment's variables.

Only `~/.bashrc` loads boat's file, and bb's daemon is a systemd user
service, so before each enrollment, on create and on resume, the plugin
writes a drop-in,
`~/.config/systemd/user/bb-host-daemon-.service.d/boat-sign-ins.conf`. At
every daemon start it copies the file into `/run/user/<uid>`, readable by the
user alone, and loads it, so agent turns and terminals get boat's variables.
The drop-in holds no secret.

Variables set in bb's own machine environment still reach every agent turn
through bb core, and win over boat's value for the same name.

`bb boat status` reports Claude Code, Codex and the AI proxy for the default
launch's environment.

**The AI proxy** is your boat account's choice (`boat ai proxy on|off`); the
plugin never changes it.

- **Off**: the sandbox holds the real tokens. boat refreshes them only at
  each sandbox start and resume (and before its own `boat prompt`, which bb's
  turns are not), so a sandbox that stays up long enough can hold an expired
  token until its next resume.
- **On**: the sandbox holds placeholders, and boat renews the real tokens on
  its side. It costs $1 a day plus $1 per 1,000 requests, from the wallet.

**boat's CLI token in the sandbox** (`--boat-credentials`, on by default)
stays on. It acts only on its own sandbox (read, stop, commands, files,
snapshots of that sandbox), so nothing a thread runs can reach your other
sandboxes through it.

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

## Idle stops and resumes

Once a minute the plugin checks every boat machine. A machine is **busy**
while any thread on it is `pending`, `starting`, `active` or `stopping`, so a
turn that runs a long, silent command (a slow build or test run) is never
stopped. It is **idle** from the later of: the end of its last turn, the
last minute it was seen busy, the last input in one of its terminals, and its
create or resume.

After **Stop after idle** minutes idle, the plugin asks bb to suspend the
machine. It looks again just before asking, so a follow-up or terminal input
that arrived during the check cancels the stop. bb stops its daemon and the
plugin runs a boat stop, which saves the disk. `bb machine list --all` then shows the machine `disconnected`
(`bb machine show <host-id>` says phase `suspended`), and `boat list --all`
shows the sandbox `stopped`. A suspended machine costs no machine time.

A background agent (Claude Code's Agent tool with `run_in_background`) keeps
its thread `active` until it reports back, so it counts as busy (checked live
on 2026-11-08). A command the agent left running in the background after its
turn ended does not: a forgotten dev server must not keep a sandbox billing.

**A follow-up resumes it.** A message to the thread (`bb thread tell`, or the
composer) is queued with `Waiting for boat <sandbox-id> to be ready` while bb
resumes the machine, then runs. The thread keeps the same bb machine id and
the same boat sandbox, so every file on the disk is still there, and
`.bb-env-setup.sh` does not run again. `bb machine resume <host-id>` does the
same without a message. A turn a suspend cut off is not continued; send it
again.

- **Within 10 minutes of the stop** boat hands back the same machine it kept,
  in a few seconds, and it does not count as a start (`bb boat status` shows
  the same numbers before and after), and `/tmp` is still there.
- **Later**, boat starts a new machine on the saved disk, which counts as a
  start and goes through the start limits above. `/tmp` and running programs
  are gone; bb's daemon comes back by itself.
- A sandbox deleted outside bb, or whose disk boat deleted after its
  stopped-disk retention (at least 14 days), cannot resume: the thread shows
  `… remove this machine.` Remove it with `bb machine remove <host-id> --yes`.

**The auto-stop lease.** boat stops a sandbox at its auto-stop deadline
whatever runs on it. Every sandbox is created with a 2-hour auto-stop, and
while bb runs the plugin moves the deadline back to 2 hours from now whenever
it is under an hour away (`boat info <sandbox-id>` shows `archiveAfter`),
including just before an idle stop and while bb is still suspending the
machine, so a stop bb refuses or that fails leaves the sandbox covered. So
boat never stops a sandbox bb is using, and stops one by itself only about an
hour after this bb server stopped running. Every resume, by a follow-up or
`bb machine resume`, also sets the deadline back to 2 hours from then: boat
otherwise keeps whatever auto-stop was last set on the sandbox, by hand or by
`boat extend --ttl`.

## Drift and leaks

Each minute's check also compares what bb thinks with what boat says, and
puts bb right:

- **boat stopped a sandbox on its own** (its auto-stop after bb was away, an
  empty wallet, an error), or it was deleted with `boat delete`, while bb has
  the machine active: the plugin asks bb to suspend the machine, which finds
  nothing left to stop. bb notices within about two minutes: for the first
  minute or so bb still holds the stopped daemon's connection, so its first
  suspend gives up after 30 s and the next check succeeds. A follow-up then
  resumes the sandbox as usual. For a deleted sandbox the follow-up fails with
  `… no longer exists; remove this machine.`; remove it with
  `bb machine remove <host-id> --yes`.
- **Someone resumed a bb-suspended sandbox** (`boat resume`, the boat
  dashboard): the plugin asks bb to reconcile the machine, and bb stops the
  sandbox again within about a minute. bb keeps showing it suspended
  throughout. Resume through bb (a follow-up or `bb machine resume`) instead.
- **A leaked sandbox**: one labelled `bb.boat/owner=<this server>` and
  `bb.boat/role=machine` that no bb machine uses (a create that crashed before
  bb recorded it, a machine bb removed without boat deleting the sandbox). Once
  it is 15 minutes old and running, the plugin stops it. It never deletes one:
  a stop ends the bill and keeps the disk, so a wrong call loses nothing.
  Check what is on it, then delete it yourself with `boat delete <sandbox-id>`.

The plugin looks only at sandboxes carrying this server's owner label, plus,
by id, any machine's sandbox missing from that list, so another bb server's
sandboxes on the same boat account are never touched.

## `bb boat sandboxes`

Lists every sandbox this bb server owns: one row per machine, then each
orphan, with the notes the next minute's check would act on. It runs the same
look as the check but changes nothing.

```text
SANDBOX      TYPE   BOAT     MACHINE                      AUTO-STOP          NOTES
bx_aaaaaaaa  small  running  host_1 (active)              2026-11-08T23:30Z
bx_bbbbbbbb  small  stopped  host_2 (active)              -                  stopped by boat; sweep will record the machine as suspended
bx_cccccccc  -      gone     host_3 (suspended)           -                  no longer exists on boat, so a follow-up cannot resume it; remove the machine with `bb machine remove host_3 --yes`
bx_dddddddd  small  stopped  -                            -                  stopped through the API; orphan: no bb machine uses it
```

- **BOAT** is boat's state: `starting`, `running`, `stopping`, `stopped`,
  `failed`, or `gone` once boat no longer has the sandbox.
- **MACHINE** is the bb machine and its phase (`active`, `suspended`, …);
  `-` for an orphan.
- **AUTO-STOP** is boat's deadline in UTC, `-` while stopped.
- **NOTES** say who stopped a stopped sandbox (`stopped by boat`,
  `stopped through the API` for bb's own stops and `boat stop`, or boat's error
  text), then one note per action the next check takes (`sweep will …`).

`--json` prints the rows as an array of `{sandboxId, type, boatPhase,
machine: {hostId, phase} | null, archiveAfter, notes}`. The command exits 1
with the same problem lines as `bb boat status` when the key does not work.

## `bb boat templates`

Lists boat's stock image and every saved snapshot on the account, in any
status, then every environment, each with the `--machine-inputs` to use it,
then the default launch as a full spawn command. Every `--machine-inputs` value
and every printed command is shell-quoted, so an environment name with spaces
or an apostrophe pastes as is.

```text
TEMPLATE          STATUS  SIZE   SAVED              --machine-inputs             NOTES
boat stock image  ready   -      -                  '{"template":null}'
node-tools        ready   small  2026-11-09T10:12Z  '{"template":"node-tools"}'  default
py-ml             failed  -      2026-11-09T11:02Z  -                            source sandbox was deleted

ENVIRONMENT     PASSES                                               --machine-inputs                    NOTES
base            agents, GitHub, secrets                              '{"environment":"base"}'            boat's default; default
customer-demos  AI proxy placeholders only (safe for third parties)  '{"environment":"customer-demos"}'

Default launch (Settings → boat Sandbox): a default boat sandbox from template node-tools in environment base.
  bb thread spawn --project <project-id> --environment-provider boat-sandbox \
    --machine-inputs '{"template":"node-tools","environment":"base","preset":"default"}' --prompt "…"
Save a template from any boat sandbox with: boat snapshot <sandbox-id> <name>
```

**SIZE** is the size the template was saved from, **SAVED** is in UTC, and
**NOTES** marks the defaults and carries boat's error for a failed save.
**PASSES** is what the environment gives a sandbox: any of `agents`, `GitHub`
and `secrets`, `nothing (safe for third parties)`, or
`AI proxy placeholders only (safe for third parties)`. `boat's default` marks
the environment boat uses when nothing names one; `default` marks the one a
thread that names none gets.

`--json` prints `{templates: [{name, status, error, savedFrom, savedAt}],
environments: [{name, isBoatDefault, withholdsAll, proxiesAi, passes: {agents,
github, secrets}, profileId}], defaults: {template, environment, preset}}`.
It never carries an environment's variables or secret files. The command
exits 1 with the same problem lines as `bb boat status` when the key does not
work.

## Settings

Settings → boat Sandbox, or `bb plugin config boat-sandbox`:

- **API key** (`apiKey`, secret). Make one with
  `boat api-key create bb --preset ci`; the `ci` preset covers every call the
  plugin makes and only deletes sandboxes the key created. The key is stored
  in a 0600 file, never shown again, and never printed by the plugin. Paste it
  in Settings rather than passing it to `bb plugin config … set`, which leaves
  it in shell history. Do not print or echo it.
  A boat key keeps the actions it was created with. A `ci` key made before
  `snapshot.read` and `environment.read` joined the preset is refused when
  `bb boat templates` or a spawn lists templates or environments (a `403`
  naming the scope): make a new `ci` key and paste it, rather than giving the
  key more scopes (`boat api-key list` shows each key's actions).
- **Stop after idle (minutes)** (`idleMinutes`, default 15). A whole number
  from 0 to 1440; 0 never stops a sandbox for being idle (the auto-stop lease
  is still renewed). Takes effect at the next minute's check, without a reload.
- **Default size** (`defaultPreset`, default `default`). One of boat's sandbox
  types: `small`, `default`, `large`, `xlarge`.
- **Default template** (`defaultTemplate`, default empty). A boat saved
  snapshot new machines start from when a thread names none; empty is boat's
  stock image. Only the name's form is checked when you save it; whether boat
  has it is checked at each spawn and by `bb boat status`.
  `bb plugin config boat-sandbox unset defaultTemplate` goes back to the stock
  image.
- **Default environment** (`defaultEnvironment`, default empty). The boat
  environment new machines start in when a thread names none; empty is boat's
  default environment. Whether boat has it is checked at each spawn and by
  `bb boat status`.
  `bb plugin config boat-sandbox unset defaultEnvironment` goes back to boat's
  default.

bb reads the plugin's status only when the plugin loads, so after any fix (a
new key, a setting, the wallet, the network) run
`bb plugin reload boat-sandbox`. Until then `bb plugin list` keeps showing the
plugin as `needs-configuration`.

## `bb boat status`

Prints one line per fact and, for each problem, a `Fix:` line with the one
step that fixes it, ending with `bb plugin reload boat-sandbox`. Once boat
accepts the key, it adds the default launch and what its environment signs
in, each gap with a `Fix:` line. Exit 0 when boat Sandbox can run, whatever
the sign-ins say; exit 1 otherwise.

```text
API key: accepted by boat
Account: sandbox_… (octocat)
Wallet: personal
Zero data retention: off
Starts: 0/12 in the last minute, 0/60 in the last hour, 6/200 in the last day
Default launch: a default boat sandbox from template node-tools in environment base (boat's default environment)
Claude Code: connected on boat (claude-subscription)
Codex: not connected on boat
Fix: Sign in to ChatGPT, or add an OpenAI API key, on https://boat.dev/dashboard?tab=agents
AI proxy: off for your boat account
```

**Default launch** is what a thread that names nothing gets, from the
settings, checked against boat's saved snapshots and environments. A Default
template or Default environment boat does not have prints the refusal a spawn
would get, with a `Fix:` for that setting:

```text
Default launch: refused: boat has no environment "nope" (Settings → boat Sandbox → Default environment). Run `bb boat templates` to list them.
Fix: Run `bb plugin config boat-sandbox set defaultEnvironment <name>` with an environment `bb boat templates` lists, or `bb plugin config boat-sandbox unset defaultEnvironment` for boat's default environment.
```

- **Claude Code** and **Codex** are `connected on boat` with the credential
  that signs them in, `not connected on boat`, `withheld` when the
  environment does not pass agent credentials (with the `boat env set`
  command that lets them through), or
  `through boat's AI proxy (environment … passes placeholders)` for an
  environment safe for third parties with proxy placeholders.
- **AI proxy** is on or off for your boat account (see Sign-ins from boat).
- A row boat will not show reads `unknown (<reason>)` and the command goes on.
  A `ci` key lacks boat's `account.admin` scope, so the Claude Code, Codex and
  AI proxy rows read
  ``unknown (the API key lacks boat's account.admin scope; `boat ai profiles` shows it)``.
  The plugin does not ask for that scope, because it would let the key change
  the account's AI keys and proxy. `boat ai profiles` and `boat ai proxy` show
  the same facts.
- When boat cannot list the templates or environments, the default launch
  and the three rows read `unknown (<boat's message>)`.

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
