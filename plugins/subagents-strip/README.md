# bb-plugin-subagents-strip

A live strip above a thread's composer that counts the thread's subagents and
child threads and how long they have taken, and opens into one row per subagent
that expands to its report and latest steps and opens its full transcript in
the side panel or its own thread.
Frontend only:
`server.ts` is the empty entry bb requires.

- `bb.ts`: bb's row and event types and the SDK slice the thread source
  reads, derived from the installed SDK.
- `delegate.ts`: the canonical `Delegate` every other module reads.
- `normalise.ts`: delegation rows plus background-task events become
  delegates. The only place provider quirks live.
- `child-threads.ts`: the thread's child threads become delegates: status
  from the thread, steps, report, and end from its own timeline, the spawning
  turn from the parent's.
- `steps.ts`: a delegate's child rows as steps (`childSteps`), which of them
  the transcript and the trail show (`transcriptSteps`, `trailSteps`), and
  what each says and did (`stepLabel`, `stepKind`, `stepFailed`, `firstLine`,
  `stepIntents`).
- `work-groups.ts`: the trail's lines, steps folded the way bb's chat folds
  them (`trailItems`); `work-label.ts`: a group's words in bb's chat's
  wording ("Explored 3 files, ran 2 commands"); `thread-tell.ts`: the
  commands bb's chat shows as a message to a thread (`isThreadTell`), in
  their plain form only. All three mirror functions of bb's own client,
  named in their comments.
- `roster.ts`: which delegates the strip shows, the census, the elapsed span,
  each row's detail line and elapsed time, and an expanded row's meta line
  (`metaParts`).
- `thread-source.ts`: one thread's delegates kept live from bb
  (`createThreadSource`).
- `source.ts`: shares one thread source per thread across the window
  (`useThreadDelegates`).
- `transcript.ts`: the transcript tab's reference and the params that name its
  delegate (`TRANSCRIPT_TAB`, `transcriptParams`, `parseTranscriptParams`).
- `clock.ts`: one shared 1 s tick and the time formats (`formatDuration`,
  `formatOffset`, `formatClockTime`).
- `app.tsx`, `ui/`, `roster.css`: the composer banner and the transcript tab.
  `ui/RosterBanner.tsx` is the summary row and the list, `ui/DelegateRow.tsx`
  one row, its expanded detail, and Open thread, `ui/DelegateDetail.tsx` the
  meta line, outcome, and step icon the row and the tab share,
  `ui/TranscriptTab.tsx` the side-panel transcript, `ui/scroll.ts` the
  overflow and live tail of a scrolling body,
  `ui/Avatar.tsx` the avatar and stack, `ui/Motion.tsx` the rolling text,
  digits, and status dot, `ui/room.ts` the room the list may open into.
- `fixtures/claude-thread.json`, `fixtures/claude-stopped-failed.json`:
  trimmed real Claude Code captures the tests run on, the second with agents
  stopped by the thread and by TaskStop and an agent call refused at launch;
  `normalise.test.ts` says how each was taken. `fixtures/child-threads.json`:
  real child threads (settled, running, stopped, failed, waiting, reused);
  `child-threads.test.ts` says how each was taken. `fixtures/claude-groups.json`:
  one real delegation whose trail was compared with bb's chat live;
  `work-groups.test.ts` says how it was taken.

## Develop

```sh
bb plugin install ./plugins/subagents-strip   # once
bb plugin dev plugins/subagents-strip         # rebuild and reload on save
npm test --workspace plugins/subagents-strip
```

To see it live, ask a Claude Code thread to launch two subagents with
`run_in_background: true`.
