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
  `createCoordinator`, `startCoordinator`, `setProfile`, `deleteCoordinator`, `board`, `issue`, `setVerify`, `answerDecision`, `needsYou`,
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
  the events the plugin tells a regional manager about, and `doorbellText`,
  the wake message, which holds no agent-written text; `own-tree.ts` in it
  decides, from the latest stored event, whether a read of the regional
  manager's own working tree records a warning or its clearing.
  `src/model/reminder.ts`: a reminder, and the one parser of `crew_remind`'s
  times. `src/model/decision.ts`: a question put to the user, and an issue's
  decisions: those questions naming it and those recorded on it, oldest first.
  `src/model/profile.ts`: a regional manager's profile (name, description,
  avatar) and the icons an avatar can be; the name is the thread's title,
  which bb keeps, and the store keeps the rest.
- `src/server/`: `store/` holds every SQL statement, one file per cluster
  (issues, agents, checks, inbox, pull requests) composed by `store.ts`, and
  `migrations.ts`, the one list of statements, which only grows; `inbox/` is
  the only writer of events and the only sender of doorbells, with the
  thread watch that turns an agent's idle, failure or question into an
  event, and the own-tree watch that reads the regional manager's working
  tree through `bb--git` when its turn ends; `spawn.ts` mints a ticket and
  spawns a regional manager, agent or verifier thread, and binds it on the
  spawn answer and on `thread.created`; `roles.ts` is the one `configure`
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
  rename), the board Memory's rpc handlers (a save there wakes the
  regional manager) and the idempotent upgrade of 0.4's memory as the plugin
  loads, whose table also tells the memory tools what replaced an old file; `manager/` a regional manager's record as the panel
  changes it, one operation per regional manager at a time: created with no
  thread, started by the goal from its page (its thread spawned once, however
  often the goal is sent), its profile edited, which retitles a started one's
  thread before it stores the rest, and deleted while it has no thread (a
  start finds the thread an earlier start spawned but never bound before it
  spawns one); and the upgrade of the regional managers 0.3.0 created, run as the
  plugin loads and again from the tick after a pass that failed, decided by
  each thread's user messages: one with a real message keeps its thread,
  its missing GOAL.md that first message and any queued placeholder taken
  out; one whose only user messages are the placeholder becomes one not
  started yet, its queue emptied and its thread archived; and one with no
  thread becomes one not started yet.
  `server.ts` runs the once-a-minute tick: agents, then
  the PR watch, then the verifiers, then the inbox (due reminders, unsent
  doorbells).
- `src/app/panel/`: the nav panel, its list (not started first, then by
  project), the New page (the profile and Create) and its routes, and the
  name it puts in bb's title bar. `src/app/profile/`: the avatar tile, the
  profile's fields, shared by the New page and the profile's editor, Delete
  for a manager not started yet, and `useManager`, a started one's name from
  bb's thread list joined with what the plugin keeps. The panel's page of a
  manager not started yet holds its profile and bb's composer for its goal;
  a started one's opens its thread. `src/app/thread/`: the manager's icon
  and name above its thread's composer, which open the profile's editor.
  `src/app/board/`: the Board and its thread tab, with Memory at its bottom;
  `issue/` its lanes and issue rows, `issue/detail/` an issue opened in
  place. `src/app/memory/`: the board's Memory section, its editor
  and the drafts it keeps.
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
