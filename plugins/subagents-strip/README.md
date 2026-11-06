# bb-plugin-subagents-strip

A live strip above a thread's composer that counts the latest prompt's subagents
and child threads, plus any still running, and how long they have taken, and
opens into one row per subagent that expands to its report and latest steps and
opens its full transcript in the side panel or its own thread; a Subagents tab in
the side panel lists every subagent in the thread, grouped by the prompt it was
launched after.
Frontend only:
`server.ts` is the empty entry bb requires.

- `bb.ts`: bb's row and event types and the SDK slice the thread source
  reads, derived from the installed SDK.
- `delegate.ts`: the canonical `Delegate` every other module reads.
- `normalise.ts`: delegation rows plus background-task events become
  delegates, and the thread's turns and the messages that started them (`turnsOf`). The only
  place provider quirks live.
- `child-threads.ts`: the thread's child threads become delegates: status
  from the thread, steps, report, and end from its own timeline, the spawning
  turn from the parent's.
- `steps.ts`: a delegate's child rows as steps (`childSteps`), which of them
  the transcript and the trail show (`transcriptSteps`, `trailSteps`), and
  what each says and did (`stepLabel`, `stepKind`, `stepFailed`, `firstLine`,
  `stepIntents`, `messageText`, which drops bb's browser-preview directive).
- `work-groups.ts`: the trail's and the transcript's lines, steps folded the
  way bb's chat folds them (`trailItems`, `transcriptItems`, the second with
  reasoning in them); `work-label.ts`: a group's words in bb's chat's
  wording ("Explored 3 files, ran 2 commands"); `thread-tell.ts`: the
  commands bb's chat shows as a message to a thread (`isThreadTell`), in
  their plain form only. All three mirror functions of bb's own client,
  named in their comments.
- `roster.ts`: the two scopes: the strip's rows and what it leaves out
  (`selectRoster`), and the Subagents tab's batches, one per user prompt, with
  each label and default (`selectBatches`); the census, each part naming the
  newest delegate it counts (`census`, `batchCensus`), the elapsed span, each
  row's elapsed time, and an expanded row's meta line (`metaParts`). `detail-line.ts`: a row's second line (`detailLine`).
- `thread-source.ts`: one thread's delegates kept live from bb
  (`createThreadSource`): a bounded live read, plus the history before it,
  read in outline on start and in full while a reader wants it (`wantHistory`,
  whose release cancels a walk under way).
- `source.ts`: shares one thread source per thread across the window
  (`useThreadDelegates`, which also asks it for the full history when told).
- `subagents-tab.ts`: the Subagents tab's reference, opening it, optionally
  landing on one delegate (`openSubagents`, `useLanding`), and whether it shows
  (`subagentsTabShown`). `subagents-view.ts`: the tab's UI state and how a click
  or a landing changes it (`landOn`, `toggleBatch`, `toggleRow`).
  `thread-state.ts`: UI state kept per thread outside a component, for the
  threads last changed (`threadState`, `useThreadState`), which a hidden panel
  tab would lose.
- `transcript.ts`: the transcript tab's reference and the params that name its
  delegate (`TRANSCRIPT_TAB`, `transcriptParams`, `parseTranscriptParams`).
- `clock.ts`: one shared 1 s tick and the time formats (`formatDuration`,
  `formatOffset`, `formatClockTime`).
- `app.tsx`, `ui/`, `roster.css`: the composer banner and the two tabs.
  `ui/RosterBanner.tsx` is the summary row, the list, and its previous row,
  `ui/SubagentsTab.tsx` the Subagents tab, `ui/BatchSection.tsx` one of its
  batches' label and rows, `ui/DelegateRow.tsx`
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
  `child-threads.test.ts` says how each was taken. `fixtures/claude-groups.json`
  and `fixtures/claude-panel.json`: real delegations whose trail and transcript
  were compared with bb's chat live; `work-groups.test.ts` says how they were
  taken. `fixtures/claude-turns.json`: real top-level rows of the turns the
  thread's seed prompt, a user, a bb system message, and no message started; `normalise.test.ts` says
  how they were taken.

## Develop

```sh
bb plugin install ./plugins/subagents-strip   # once
bb plugin dev plugins/subagents-strip         # rebuild and reload on save
npm test --workspace plugins/subagents-strip
```

To see it live, ask a Claude Code thread to launch two subagents with
`run_in_background: true`.
