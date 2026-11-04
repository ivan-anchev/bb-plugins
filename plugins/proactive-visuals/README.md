# bb-plugin-proactive-visuals

Tells agents to answer data with an inline chart, using bb's built-in
`inline-vis` renderer. Headless: one `bb.agents.configure` hook, no tools,
settings, or commands.

- `instructions.ts`: the standing rule, under bb's 4096-character limit.
- `server.ts`: adds the rule to top-level threads and side chats only.
- `server.test.ts`: which threads get the rule, and the length limit.

The rule follows T3 Code's "Visuals and preview" instruction, adapted to bb's
`inline-vis` fenced block and directive.

## Develop

```sh
bb plugin install ./plugins/proactive-visuals   # once
bb plugin dev plugins/proactive-visuals         # rebuild and reload on save
npm test --workspace plugins/proactive-visuals
```

Instructions take effect when a thread's provider session is next started, so
test them in a new thread.
