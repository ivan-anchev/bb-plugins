# bb-plugin-subagents-strip

A live strip above a thread's composer that counts the thread's subagents,
how many are running and done, and how long they have taken. Frontend only:
`server.ts` is the empty entry bb requires.

- `bb.ts`: bb's row and event types and the SDK slice the thread source
  reads, derived from the installed SDK.
- `delegate.ts`: the canonical `Delegate` every other module reads.
- `normalise.ts`: delegation rows plus background-task events become
  delegates. The only place provider quirks live.
- `steps.ts`: which child rows are steps (`transcriptSteps`, `trailSteps`).
- `roster.ts`: which delegates the strip shows, the census, the elapsed span.
- `thread-source.ts`: one thread's delegates kept live from bb
  (`createThreadSource`).
- `source.ts`: shares one thread source per thread across the window
  (`useThreadDelegates`).
- `clock.ts`: one shared 1 s tick and the duration format.
- `app.tsx`, `ui/`, `roster.css`: the composer banner.
- `fixtures/claude-thread.json`: a trimmed real Claude Code capture the tests
  run on; `normalise.test.ts` says how it was taken.

## Develop

```sh
bb plugin install ./plugins/subagents-strip   # once
bb plugin dev plugins/subagents-strip         # rebuild and reload on save
npm test --workspace plugins/subagents-strip
```

To see it live, ask a Claude Code thread to launch two subagents with
`run_in_background: true`.
