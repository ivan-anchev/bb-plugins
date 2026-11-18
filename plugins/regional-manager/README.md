# bb-plugin-regional-manager

Experimental: it may break with a bb update.

A long-lived regional manager, started from a panel in bb's navigation rail.
See `PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/crew-board/SKILL.md` for how it behaves. The product name lives only in
`package.json`'s `bb.name`, read by `src/name.ts`; everything else is named for
its role.

## Layout

- `server.ts`, `app.tsx`: composition roots, registrations only.
- `src/contract.ts`: the rpc contract (`coordinators`, `primaryHost`,
  `startCoordinator`, `board`, `issue`, `setVerify`, `answerDecision`, `needsYou`,
  `memoryList`, `memoryRead`, `memoryWrite`;
  tags `coordinators`, `board:<regional manager id>` and `memory:<regional manager id>`).
- `src/model/role.ts`: the role a thread holds (coordinator, agent or
  verifier), and the ticket its metadata carries until it is bound.
  `src/model/memory-file.ts`: a memory file's name, version, revision and
  write outcome, shared by tools, rpc and editor. `src/model/issue/`: an
  issue and its plan (`issue.ts`), its kinds and the pipeline each runs
  (`kind.ts`), and `status.ts`, the one derivation of an issue's status and
  Needs you, used by the board, `crew_catch_up`, `issue_read`, the rail badge
  and the PR watch. `src/model/agent.ts`: an agent, where it runs, and the
  branch an issue's pull request is read on. `src/model/execution.ts`: what a
  thread runs on, resolved against bb's catalog or refused.
  `src/model/handoff.ts`: an agent's handoff, and `handoffIsCurrent`, the one
  definition of a current handoff (no later turn started).
  `src/model/verdict/`: a check of a done handoff, its verdict, the plugin's
  read of the commit and the tree, and a branch's pull request and CI.
  `src/model/board/board-groups.ts`: the board's lanes. `src/model/inbox/`:
  the events the plugin tells a regional manager about, and `doorbellInput`,
  the wake message, which holds no agent-written text and puts what the user
  isn't shown in a part only the thread sees; `own-tree.ts` in it is a read
  of the regional manager's own checkout, and when two reads found the same
  changed files.
  `src/model/reminder.ts`: a reminder, and the one parser of `crew_remind`'s
  times. `src/model/decision.ts`: a question put to the user.
- `src/server/`: `store/` holds every SQL statement, one file per cluster
  (issues, agents, checks, inbox, pull requests) composed by `store.ts`, and
  `migrations.ts`, the one list of statements, which only grows; `inbox/` is
  the only writer of events and the only sender of doorbells, with the
  thread watch that turns an agent's idle, failure or question into an
  event, and the own-tree watch that reads the regional manager's working
  tree through `bb--git` when its turn ends, and changes nothing there;
  `spawn.ts` mints a ticket and spawns a regional manager (its first message
  the goal as typed, then the plugin's note of its role, agent-only), agent
  or verifier thread, and binds it on the spawn answer and on
  `thread.created`; `roles.ts` is the one `configure`
  callback, with each role's tools, skills and rule text; `issues/` the
  issue tools, their texts and the one read of an issue's facts; `agents/`
  the agent tools, starting, messaging, stopping and ending agents, an
  agent's brief, and the thread events that end an agent or refresh the
  board; `execution/` reads bb's provider catalog and what a thread runs on;
  `tools/` the fleet-wide `crew_` tools, `agent_handoff`, and the catch-up
  texts; `verify/` the verify step (a verifier per done handoff, its brief,
  model and `issue_verdict`, and the one automatic fix round that sends a
  first failed verdict's findings back to the agent); `watch/` the PR watch
  through `gh`; `board/` the board's read and its rpc handlers (the
  verification switch and the answers to decisions); `memory/` the memory
  files beside `data.db` (compare-and-swap writes through a temp file and a
  rename) and the Memory editor's rpc handlers (a save there wakes the
  regional manager). `server.ts` runs the once-a-minute tick: agents, then
  the PR watch, then the verifiers, then the inbox (due reminders, unsent
  doorbells).
- `src/app/panel/`: the nav panel, its list, and the New page around bb's
  new-thread composer. `src/app/board/`: the Board, its thread tab and its
  panel page; `issue/` its lanes and issue rows, `issue/detail/` an issue
  opened in place. `src/app/memory/`: the Memory page and its editor.
- `skills/regional-manager/`: the regional manager's playbook, selected only
  for it. `skills/agent-work/`: an agent's playbook, selected only for
  agents. `skills/verifying/`: a verifier's playbook. `skills/crew-board/`:
  the user guide, selected for every thread.

## Develop

```sh
npm run typecheck
npm test
bb plugin build
```
