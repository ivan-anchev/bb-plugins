Wakes your Grok Bots by webhook when a bb thread needs attention: an open question or approval, a finished turn, or a failure. Nothing else in a thread, no message or tool call, ever wakes a bot.

## What you get

- **Three events, one POST each.** `interaction` when a question, approval, or plan is waiting; `finished` when a turn ends; `failed` when the thread fails. A state change sends at most once, even if bb signals it twice.
- **Routing by section or project.** A JSON setting maps section and project ids to target names; a section match beats a project match. Unrouted threads wake nobody. Only top-level, visible threads count.
- **Secrets that stay secret.** Each target's webhook URL and sender key are masked secret settings that appear as soon as you add the target. They never show up in settings, logs, the failure log, or command output.
- **A small, fixed body.** `{project, section, thread, event, title, summary}` with a one-line summary of at most two sentences, sent with `Authorization: Bearer` and `X-Automation-Key` headers.
- **A failure log you can drain.** A non-2xx answer, timeout, network error, or missing secret keeps the event locally. `bb bot-wake failures` lists them, `bb bot-wake drain` retries them, and `bb bot-wake test <target>` checks a target.

## How it works

The plugin runs on the bb server and listens to bb's interaction, idle, and failed thread signals. It makes one attempt per event with an 8-second timeout, and keeps undelivered events in its own SQLite file. It adds no UI beyond its settings.
