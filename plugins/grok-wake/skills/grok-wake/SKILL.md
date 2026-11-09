---
name: grok-wake
description: Explain and operate the Grok Wake plugin, which POSTs a small JSON body to a webhook (a Grok Bot) when a top-level bb thread needs attention: an open question or approval, a finished turn, or a failure. Covers the routes setting, the per-target URL and key secrets and how to set them safely, the body, and the `bb grok-wake failures`, `drain`, and `test` commands. Use when the user asks why a bot was or was not woken, how to route a project or section to a bot, or to retry or test deliveries.
---

# Grok Wake

Grok Wake watches thread state on the bb server and wakes a bot by webhook
when a thread needs someone to look at it. Each wake is one `POST` to the
target the thread routes to.

## What wakes a bot

Only top-level threads you can see wake a bot. Hidden threads and threads
with a parent (subagents, workers) never do.

| Event | When |
| --- | --- |
| `interaction` | A question, approval, or plan is open and waiting. |
| `finished` | The thread went idle after a turn. A thread idling on an open question or approval sends `interaction` instead. |
| `failed` | The thread failed. |

Messages, tool calls, and progress never wake a bot. One state change sends
at most one POST, even when bb signals it twice; a later turn that finishes
again sends again. A thread a user stops (interrupted) sends nothing.

## Settings

**Routes** (`routes`): JSON mapping bb section ids and project ids to target
names. A section match beats a project match; a thread that matches neither
wakes nobody and is not logged.

```json
{"sections": {"sec_abc123": "ops"}, "projects": {"proj_xyz789": "dev"}}
```

- Target names use letters, digits, and `_`, and are case-insensitive (`ops`
  and `OPS` are one target).
- A malformed value is refused when saved, with the problem shown under the
  field (or printed by `bb plugin config`).
- Find ids with `bb status` (project) and `bb thread section list` (sections).

## Secrets

Each target in routes gets two secret settings: `GROK_WAKE_<TARGET>_URL` (the
webhook) and `GROK_WAKE_<TARGET>_KEY` (the sender key). Target `ops` uses
`GROK_WAKE_OPS_URL` and `GROK_WAKE_OPS_KEY`.

- Saving routes with a new target reloads the plugin, so its two fields
  appear at once in **Settings → Installed plugins → Grok Wake**.
- Set them there: the fields are masked, and the values live only in 0600
  files under the plugin's `secrets/` directory, never in bb's database, logs,
  or the failure log.
- `bb plugin config grok-wake set GROK_WAKE_OPS_KEY <value>` works too, but the
  value lands in the command line and your shell history. Prefer the Settings
  page.
- Removing a target from routes deletes its stored URL and key.
- A routed target missing either secret counts as a failed delivery
  (`missing-secret`) and is logged.

## The request

```
POST <GROK_WAKE_<TARGET>_URL>
Content-Type: application/json
Authorization: Bearer <key>
X-Automation-Key: <key>

{"project": "proj_…", "section": "sec_…" | null, "thread": "thr_…",
 "event": "interaction" | "finished" | "failed", "title": "…", "summary": "…"}
```

- `title` is the thread's title, else its fallback title, else `Thread <id>`.
- `summary` is one line of at most two sentences and 280 characters: the
  question, approval, or plan prompt; the start of the last reply; or the
  error. A bot that needs more looks the thread up by `thread`.
- One try, 8-second timeout. A non-2xx answer, a timeout, a network error,
  or a missing secret puts the event in the failure log.
- Redirects are not followed: a 3xx answer is a failed delivery (`http 307`
  and so on), so the key never travels to the redirect's target. Point the URL
  at the final address.
- A POST still in flight when the plugin reloads or stops is abandoned and
  logged as `cancelled`; drain it later.

## Commands

| Command | Effect |
| --- | --- |
| `bb grok-wake failures [--limit N]` | List undelivered events, oldest first: time, target, event, thread, title, reason (`http <status>`, `timeout`, `network`, `missing-secret`, `cancelled`). Shows 50 by default. |
| `bb grok-wake drain` | Retry every logged event once. Delivered ones leave the log; the rest stay with their new reason. Prints the counts. If the command is interrupted, it stops after the current event and leaves the rest untouched. |
| `bb grok-wake test <target>` | POST a harmless body (`"event": "test"`) to the target and print the HTTP status, or the failure reason. An unknown target or an unset secret is an error naming the missing setting. A failed test is not logged. |

Add `--json` to any command for machine-readable output. No command prints a
URL or key.

## Procedure

1. Route: set `routes`, then fill in the new target's URL and key on the
   Settings page.
2. Check: `bb grok-wake test <target>` should print `HTTP 200` (or another 2xx).
3. After an outage: `bb grok-wake failures`, fix the receiver, then
   `bb grok-wake drain`.
