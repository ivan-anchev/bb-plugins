# bb-plugin-bot-wake

Wakes Grok Bots by webhook when a top-level bb thread needs attention. Headless:
server code, a `routes` setting with per-target secret settings, and the
`bb bot-wake` command. User docs: `skills/bot-wake/SKILL.md`.

## Develop

```sh
bb plugin install ./plugins/bot-wake   # once
bb plugin dev plugins/bot-wake         # rebuild and reload on save
npm test --workspace plugins/bot-wake
```
