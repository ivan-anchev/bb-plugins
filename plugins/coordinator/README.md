# bb-plugin-coordinator

Experimental: it may break with a bb update.

A long-lived coordinating thread, started from a panel in bb's navigation rail.
See `PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/crew-board/SKILL.md` for how it behaves. The product name lives only in
`package.json`'s `bb.name`, read by `src/name.ts`; everything else is named for
its role.

## Layout

- `server.ts`, `app.tsx`: composition roots, registrations only.
- `src/contract.ts`: the rpc contract (`coordinators`, `primaryHost`,
  `startCoordinator`, `board`, `updateDraft`, `startDraft`, `memoryList`,
  `memoryRead`, `memoryWrite`;
  tags `coordinators`, `board:<coordinator id>` and `memory:<coordinator id>`).
- `src/model/role.ts`: the role a thread holds, and the ticket its metadata
  carries until it is bound. `src/model/memory-file.ts`: a memory file's
  name, version, revision and write outcome, shared by tools, rpc and editor.
  `src/model/crew.ts`: a crew, a draft until its thread is bound, and where
  and on what model it runs. `src/model/handoff.ts`: a crew's handoff, its
  verdict, and `handoffIsCurrent`, the one definition of a current handoff
  (no later turn started). `src/model/board/crew-state.ts`: `crewState`, the
  one function that puts a crew on the board, used by the board and
  `crew_catch_up`. `src/model/inbox/`: the events the plugin tells a
  coordinating thread about, and `doorbellText`, the wake message, which
  holds no crew-written text; `own-tree.ts` in it decides, from the latest
  stored event, whether a read of the coordinating thread's own working tree
  records a warning or its clearing. `src/model/reminder.ts`: a reminder, and the
  one parser of `crew_remind`'s times.
- `src/server/`: `store.ts` holds every SQL statement (tables `roles`,
  `coordinators`, `memory_revisions`, `crews`, `handoffs`, `verdicts`,
  `events`, `doorbells`, `reminders`); `inbox/` is the only writer of events and the only
  sender of doorbells, with the once-a-minute `watch` tick, the thread
  watch that turns a crew's idle, failure or question into an event, and the
  own-tree watch that reads the coordinating thread's working tree through
  `bb--git` when its turn ends and records changed files there; the tick
  first turns each due reminder into one; `spawn.ts` mints a ticket,
  saves a crew and spawns a coordinating or crew thread, and binds it on the spawn answer and
  on `thread.created`; `roles.ts` is the one `configure` callback; `tools/`
  the agent tools and the text they return; `crew/` the crew actions (one
  launch at a time per crew), the crew's brief, a crew's current handoff, the
  board and its rpc handlers (its read, and editing and starting a draft), and
  the thread events that refresh it; `verify/` the verify step (a verifier
  per done handoff, its brief, model and `crew_verdict`, and the one
  automatic fix round that sends a first failed verdict's findings back to
  the crew); `memory/` the memory files beside `data.db` (compare-and-swap
  writes through a temp file and a rename) and the Memory editor's rpc
  handlers (a save there wakes the coordinating thread).
- `src/app/panel/`: the nav panel, its list, and the New page around bb's
  new-thread composer. `src/app/board/`: the Board, its thread tab and its
  panel page; `draft/` in it holds a draft's row and editor (bb's composer and
  a criteria list), and the edit in progress, kept in localStorage until it is
  saved or cancelled. `src/app/memory/`: the Memory page and its editor.
- `skills/coordinating/`: the coordinating thread's playbook, selected only
  for it. `skills/crew-work/`: a crew thread's playbook, selected only for
  crews. `skills/crew-board/`: the user guide, selected for every thread.

## Develop

```sh
npm run typecheck
npm test
bb plugin build
```
