# grok-wake: waking OpenBot as well as Grok Bot

Recommendation from a research and design run, 2026-11-09, base `a0b4890`.
Nothing here is built yet. Paths are relative to the repo root.

## Summary and recommendation

Give each target a third field, `GROK_WAKE_<T>_BOT`: Grok Bot (the default)
or OpenBot. A small adapter per bot builds the headers and body; watching,
routing, dedupe, the failure log, `drain` and `test` stay shared. Every wake
gets a stable id when it is claimed, so a drained OpenBot wake retries with
the same delivery id, as OpenBot requires.

Keep the plugin id, CLI group, secret prefix and tag prefix `grok-wake`.
Existing installs upgrade with no action, and Grok Bot requests stay
byte-identical until a gated last step drops the undocumented
`X-Automation-Key` header. Build order: wake identity and the bot seam, then
OpenBot targets, then the header removal.

## What OpenBot is

**OpenBot here means Nightly Labs OpenBot** ([openbot.run](https://openbot.run/),
[github.com/nightly-labs/openbot](https://github.com/nightly-labs/openbot)),
with about 85% confidence. It is "a local-first desktop workspace for
persistent AI teammates" that runs Codex, Claude and Grok, and it is marketed
as a ["Grok Bot alternative"](https://www.producthunt.com/p/openbot-3/openbot-4).
It has a "webhook routine" that matches Grok Bot's. The repo had 6,619 stars
and a push on 2026-11-09.

Alternatives considered and rejected:

| Candidate | Why not |
|---|---|
| [meetopenbot/openbot](https://github.com/meetopenbot/openbot) ("OS for Agents") | Runner-up. 347 stars. Only a local, unauthenticated `POST /api/publish` on port 4132; no inbound webhook documented |
| [openbot.ai](https://openbot.ai/) | A robotics dataset catalog |
| [hewol/OpenBot](https://github.com/hewol/OpenBot) | A Discord bot, archived 2024-07-03 |
| Intel OpenBot | A smartphone robot; not researched further |

## Inbound contracts compared

Sources: OpenBot's [docs/webhooks.md](https://github.com/nightly-labs/openbot/blob/main/docs/webhooks.md)
and xAI's [Grok Bot routines](https://docs.x.ai/grok-bot/skills-routines-and-automations).
Rows marked *third-party* come only from [Hookdeck's Grok Bot guide](https://hookdeck.com/webhooks/platforms/using-hookdeck-with-grok-bot-reliable-webhook-triggers.md),
which reports observed behavior, not a published contract.

| | Grok Bot routine | OpenBot webhook routine |
|---|---|---|
| URL | Per routine, shown in the desktop app. *Third-party:* `https://api2.cursor.sh/automations/webhook/<id>` | Per routine, issued by an account relay once the host is signed in; no template documented |
| Auth | `Authorization: Bearer <key>` | HMAC-SHA256 over `<ts>.<deliveryId>.<body>`, keyed by the full `whsec_…` secret; headers `X-OpenBot-Timestamp`, `X-OpenBot-Delivery-Id`, `X-OpenBot-Signature: sha256=<hex>`. Standard Webhooks headers also accepted |
| Clock | n/a | Timestamp within ±5 min of the host clock |
| Body | Optional, free-form JSON | `{type (required, 1–256 chars), occurredAt?, data?}`, ≤ 64 KiB, `application/json` required (else 415) |
| Success | 200 = run started | 202 = accepted, **also when the routine is paused or a filter does not match**; 200 = duplicate delivery id |
| Errors | Any non-200 = no run. *Third-party:* 400 paused, 401 bad key | 400, 401, 404, 413, 415 final; 429 and 503 retry later (503: host offline, busy, or no answer in 2.5 s) |
| Dedupe | None documented | Delivery id per routine, kept 7 days |
| Retries | Caller's job | Caller's job: same id and body, fresh timestamp and signature. The relay does not queue |
| Limits | 200 runs/h per routine, 300/h overall | 429 documented, no numbers; 64 webhook routines per host |

`X-Automation-Key` appears in no Grok Bot source found (xAI docs, Hookdeck,
the [Cursor forum](https://forum.cursor.com/t/webhook-credentials-in-app-links-grokbot/174163/7.md),
[tdoc PR #902](https://github.com/tornado-doc/tdoc/pull/902)). Only grok-wake
itself sends and documents it: `plugins/grok-wake/delivery.ts:54`,
`plugins/grok-wake/target-secrets.ts:67`, `plugins/grok-wake/skills/grok-wake/SKILL.md:67`
and `plugins/grok-wake/PLUGIN_OVERVIEW.md:8`. The research notes also list
the plugin README; at `a0b4890` it does not mention the header.

## Proposed design

**Today.** Targets are bare names from the `routes` setting
(`plugins/grok-wake/routes.ts:63-73`), each with two secrets,
`GROK_WAKE_<T>_URL` and `_KEY` (`plugins/grok-wake/target-secrets.ts:23-25`).
`post` sends one request shape to every target: Bearer plus
`X-Automation-Key`, body `JSON.stringify` of the six-field wake body, 8 s
timeout, no redirects, any 2xx delivered (`plugins/grok-wake/delivery.ts:41-65`).
Failure-log rows hold id, time, target, body and reason
(`plugins/grok-wake/failure-log.ts:27-35`). `drain` re-sends the stored body
(`plugins/grok-wake/drain.ts:18`). Nothing records a target's bot: an
endpoint is only a URL and a key (`plugins/grok-wake/target-secrets.ts:5-8`).

**Change.**

- **A bot field per target.** `GROK_WAKE_<T>_BOT` is a select with options
  `grok` ("Grok Bot", default) and `openbot` ("OpenBot"), validated at write
  time with `experimental_schema`. The SDK's select descriptor supports
  options, labels, default and schema
  (`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts:19370-19378`),
  and a field with a default always reads as a value (`:19389`).
- **A bot is an adapter.** A pure function `(wake, key, now) → {headers, body}`,
  one per bot in `ADAPTERS: Record<Bot, BotAdapter>`, so a missing adapter is
  a compile error. Delivery keeps the single POST, timeout, no redirects and
  the 2xx rule for both bots, which covers OpenBot's 202 and its duplicate
  200. This mirrors how Grafana and Uptime Kuma declare
  a receiver kind as a `type` field and keep retry and logging outside the
  per-kind code ([grafana/alerting](https://github.com/grafana/alerting/blob/main/notify/factory.go),
  [uptime-kuma](https://github.com/louislam/uptime-kuma/blob/master/server/notification.js)).
- **A stable wake id.** `bb-` + the first 32 hex of sha256 over
  `<thread>/<kind>/<interaction id | thread.updatedAt>`: the same facts
  `claim()` already deduplicates on (`plugins/grok-wake/waker.ts:122-133`).
  The id is stored in the failure log, so `drain` resends the same id and
  body with a fresh timestamp and signature.

```ts
type Bot = "grok" | "openbot";
interface BotRequest { headers: Record<string, string>; body: string }
type BotAdapter = (wake: Wake, key: string, now: Date) => BotRequest;
interface Endpoint { bot: Bot; url: string; key: string }
type WakeId = string & { __brand: "WakeId" };   // /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
interface Wake { id: WakeId; at: number; body: WakeBody }
interface FailureEntry { id: number; target: Target; wake: Wake; reason: FailureReason }
```

On the wire:

```
POST <URL>  Content-Type: application/json
Grok Bot:  Authorization: Bearer <key>   [X-Automation-Key: <key> until task 3]
           {"project","section","thread","event","title","summary"}
OpenBot:   X-OpenBot-Timestamp: <unix s>  X-OpenBot-Delivery-Id: <wake id>
           X-OpenBot-Signature: sha256=hex(HMAC-SHA256(key=<whsec_…>, "<ts>.<id>.<body>"))
           {"type":"bb.<event>","occurredAt":"<wake time ISO>","data":{...the six fields...}}
```

Files under `plugins/grok-wake/`: new `bots.ts`, `grok-bot.ts`, `openbot.ts`,
`wake.ts`; `target-secrets.ts` becomes `target-settings.ts` (three fields per
target); `delivery.ts`, `failure-log.ts`, `waker.ts`, `drain.ts`, `cli.ts`,
`server.ts`, `target-sync.ts` and `bb-types.ts` pass a `Wake`. `routes.ts` and
`wake-body.ts` do not change. No new dependencies: HMAC and sha256 come from
`node:crypto`, and `zod` is already a runtime dependency.

**Tradeoffs accepted.** "grok" stays in an OpenBot target's names
(`GROK_WAKE_NIGHTLY_URL`, `bb grok-wake test nightly`). An OpenBot target left
on the default is sent Grok headers; `test` then prints `HTTP 401 (Grok Bot)`,
which names the mistake. OpenBot's 429 and 503 wait for a manual `drain`. A
drain follows the target's current bot, so "fix the bot, then drain" recovers.

## Migration and back-compat

| Surface | After upgrade |
|---|---|
| `routes` setting | Unchanged key, shape and semantics |
| `GROK_WAKE_<T>_URL`, `_KEY` | Same names, still `secret: true`; only the key's description text changes |
| `GROK_WAKE_<T>_BOT` (new) | Not stored for existing targets; reads as the default `grok`, so no write is needed |
| Failure-log rows | Two append-only migrations after the shipped CREATE: `ALTER TABLE failures ADD COLUMN wake_id TEXT`, then `UPDATE failures SET wake_id = 'legacy-' \|\| lower(hex(randomblob(16))) WHERE wake_id IS NULL`: random, not the rowid, which repeats across installs sharing a routine and after a db reset, where OpenBot would dedupe the later wake. Statement 1 is never edited (`plugins/grok-wake/failure-log.ts:26-35`) |
| `failures --json` | Same shape `{id, time, target, reason, body}` (`plugins/grok-wake/cli.ts:91-93`); old rows unchanged. `time` now means when the wake was claimed, up to ~8 s before the failure was recorded (`plugins/grok-wake/failure-log.ts:55`) |
| CLI commands | `failures`, `drain`, `test` unchanged; `test` text adds the bot label, e.g. `HTTP 200 (Grok Bot)`, and its JSON gains `bot` |
| Grok Bot wire | Byte-identical until task 3 removes `X-Automation-Key` |
| Plugin id, CLI group, secret prefix, tag prefix | All stay `grok-wake` (`plugins/grok-wake/package.json:2`, `marketplace.json:96`) |
| Descriptions | `package.json`, `PLUGIN_OVERVIEW.md`, README, skill and the root README catalog line name both bots, changed together |

As today, a new target gets its fields only after a reload
(`plugins/grok-wake/target-sync.ts:15-19`); dropping one unsets all three.

**Why not rename.** Secrets live under `<dataDir>/plugins/<id>/secrets/` and
the failure log in `<dataDir>/plugins/<id>/data.db`, both keyed by plugin id
(SDK `:19346`, `:19423`). Nothing documents whether bb moves them when the id
changes, so a rename could not promise a no-action upgrade. No `grok-wake/v*`
tag exists yet, so a rename is cheapest now; see open question 2.

## Open risks

- **OpenBot's 202 hides ignored events.** A paused routine or a filter
  mismatch still answers 202, so grok-wake counts the wake delivered and drops
  it from the failure log. `test` proves reachability and the signature, not
  the filter.
- **The OpenBot host must be online.** The relay does not queue. While the
  host is off or busy, wakes fail with `http 503` and sit in the failure log
  until someone runs `drain`. If `failures` fills with 503s, revisit
  automatic retries.
- **±5 min clock window.** A host clock more than 5 minutes off makes every
  wake a 401. Drain re-signs, so old rows are not affected by age.
- **Rename migration is unknown.** Whether bb moves secrets and `data.db` on
  an id rename is undocumented; settle it before any rename.
- **Which OpenBot.** About 85% confidence in Nightly Labs. If Ivan means
  another, the OpenBot adapter and docs change; the bot field, adapters, wake
  id and migrations do not.
- **Grok Bot rate limits.** 200 runs/h per routine and 300/h overall. A busy
  routed section can exceed them; the run fails and is not retried, and the
  status code for that case is not documented.
- **Live proof needs a signed-in OpenBot host.** Unit tests cannot prove the
  relay URL, the clock window or the secret format.

## Decisions made for Ivan

| Decision | Why | Alternative |
|---|---|---|
| Skipped the grilling pass | The request named goal, scope and non-goals; "which OpenBot" was a research question | Grill first |
| OpenBot = Nightly Labs OpenBot | Marketed as the Grok Bot alternative, has a webhook routine, active and widely starred | Name another OpenBot; it becomes another adapter |
| Treated as a large change (two designs and a judge) | Setting keys, secret names and the plugin id are a one-way door for installs | Treat as medium, one writer |
| Per-target bot select + adapters + stable wake id | One identity, one new column; "fix the bot, then drain" works; a third bot is one enum entry and one adapter | Store each row's bot and wire body (rejected: more columns and states, and drain could not repair a mis-set target) |
| Validate `_BOT` at write time | A bad value is rejected when set, not at the next wake | Validate only on read |
| Keep the id `grok-wake` | A rename cannot promise a no-action upgrade while bb's id migration is unknown | Rename before the first tag (e.g. `bot-wake`) after the 15-minute check |
| Drop `X-Automation-Key` last, gated on a live 200 without it | No Grok Bot source documents it, and it copies the secret into a second header | Keep sending it |
| OpenBot task needs a live 202 from a real host before merge | Unit tests can't prove the relay, clock or secret format | Accept unit tests and a ported signature vector |
| First tag `grok-wake/v0.1.0` ships with OpenBot | No tag exists, so there is no installed line to bump past | Tag the Grok-only version first |
| 429/503 stay one try + failure log + manual `drain` | One delivery policy for both bots, no timers | Automatic backoff retries |
| One doc here; the run's issue files are summarized, not committed | `docs/` holds repo-level docs; Ivan asked for a concise recommendation | Commit the run directory |

## Implementation tasks

| Task | Goal | Main files (`plugins/grok-wake/`) | Proof | Depends on |
|---|---|---|---|---|
| 1. Wake identity and bot seam | Stable wake ids and a per-bot adapter, Grok Bot only; a new failure's `time` becomes its claim time | new `wake.ts`, `bots.ts`, `grok-bot.ts`; `delivery.ts`, `failure-log.ts`, `waker.ts`, `drain.ts`, `cli.ts` | Grok request byte-identical to 0.1.0; ids deterministic; a pre-upgrade `data.db` gets distinct random `legacy-` ids; two drains send the same id; `failures --json` same shape; `npm run check`; live `test` → `HTTP 200` | none |
| 2. OpenBot targets | Bot select per target; OpenBot gets the signed envelope; docs name both bots | new `openbot.ts`; `target-secrets.ts` → `target-settings.ts`; `bots.ts`, `bb-types.ts`, `cli.ts`; skill, README, overview, `package.json`, root README, `npm run manifests` | HMAC recomputed in a test; unset `_BOT` reads `grok`; invalid value rejected; drain keeps the id with a newer timestamp; live on an unfiltered, unpaused routine (a 202 alone proves no run): history shows one run for the first delivery, one for a 503 drained after the host returns, none for a re-sent id (200); Grok target still `HTTP 200 (Grok Bot)`; settings screenshots | 1 |
| 3. Drop `X-Automation-Key` | Grok Bot gets the key once, as the Bearer token | `grok-bot.ts`, its test, key description, skill, overview | Gate: live 200 without the header (401 → keep it); headers exactly `Content-Type`, `Authorization`; `grep -ri automation-key plugins/grok-wake` empty; result in the PR | 2 |

Task 3's issue also lists the plugin README, which has nothing to remove.

## Open questions

1. **Can a real OpenBot host be used for task 2's live proof?** Default: yes,
   required before merge. Fallback: port a signature vector from
   nightly-labs/openbot's verifier tests and say so in the PR.
2. **Rename before the first tag?** Default: no. If yes, first settle bb's
   secret and `data.db` handling on a throwaway server
   ([remote-live-testing.md](remote-live-testing.md), about 15 minutes:
   install, set a secret and a failure row, reinstall under the new id).
3. **Remove `X-Automation-Key`?** Default: yes, gated on the live 200.
4. **First release version.** Default: `grok-wake/v0.1.0` with OpenBot
   included.

Working notes: `/Users/ivananchev/workspace/bb-plugins-obs/grok-wake-openbot/research/openbot.md`, `/Users/ivananchev/workspace/bb-plugins-obs/grok-wake-openbot/research/map.md`, `/Users/ivananchev/workspace/bb-plugins-obs/grok-wake-openbot/research/prior-art.md`, `/Users/ivananchev/workspace/bb-plugins-obs/grok-wake-openbot/design.md`.
