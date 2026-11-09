# bb-plugin-grok-wake

Wakes Grok Bots by webhook when a top-level bb thread needs attention. Headless:
server code, a `routes` setting with per-target secret settings, and the
`bb grok-wake` command. User docs: `skills/grok-wake/SKILL.md`.

- `server.ts`: wiring. Defines the settings, listens to `interaction.pending`,
  `thread.idle` and `thread.failed`, and registers the CLI. Aborts the
  instance's in-flight work when bb unloads it, and waits for it to settle.
- `routes.ts`: parses and validates the `routes` setting; picks a thread's
  target (section, then project).
- `target-secrets.ts`: declares `GROK_WAKE_<TARGET>_URL` / `_KEY` per target
  and reads or unsets them.
- `target-sync.ts`: on a `routes` change, unsets the secrets of dropped
  targets against the latest routes, then reloads so new targets get fields.
- `waker.ts`: thread signals become at most one POST per state change, sent
  after the handler has returned so a slow webhook never holds up bb; failed
  POSTs go to the failure log.
- `wake-body.ts`: the six-field body, its title and summary.
- `delivery.ts`: one POST with the auth headers and an 8-second timeout,
  redirects not followed; failures as a category only.
- `failure-log.ts`: the failure log in the plugin's SQLite file.
- `drain.ts`: retries the failure log once.
- `cli.ts`: `bb grok-wake failures | drain | test <target>`.
- `bb-types.ts`: SDK types the SDK does not export by name, and the host slice
  the factory uses (its two kinds of settings, its three events).
- `test-support.ts`: a local receiver and fixtures for the tests.

## Develop

```sh
bb plugin install ./plugins/grok-wake   # once
bb plugin dev plugins/grok-wake         # rebuild and reload on save
npm test --workspace plugins/grok-wake
```
