# bb-plugin-subagents-strip

A live strip above a thread's composer that counts the thread's subagents and
how long they have taken, and opens into one row per subagent with its current
step or result. Frontend only:
`server.ts` is the empty entry bb requires.

- `bb.ts`: bb's row and event types and the SDK slice the thread source
  reads, derived from the installed SDK.
- `delegate.ts`: the canonical `Delegate` every other module reads.
- `normalise.ts`: delegation rows plus background-task events become
  delegates. The only place provider quirks live.
- `steps.ts`: which child rows are steps (`transcriptSteps`, `trailSteps`)
  and what each says (`stepLabel`, `firstLine`).
- `roster.ts`: which delegates the strip shows, the census, the elapsed span,
  and each row's detail line and elapsed time.
- `thread-source.ts`: one thread's delegates kept live from bb
  (`createThreadSource`).
- `source.ts`: shares one thread source per thread across the window
  (`useThreadDelegates`).
- `clock.ts`: one shared 1 s tick and the duration format.
- `app.tsx`, `ui/`, `roster.css`: the composer banner. `ui/RosterBanner.tsx`
  is the summary row and the list, `ui/DelegateRow.tsx` one row,
  `ui/Avatar.tsx` the avatar and stack, `ui/Motion.tsx` the rolling text,
  digits, and status dot, `ui/room.ts` the room the list may open into.
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
