---
name: crew-board
description: Explain the Regional Manager plugin (bb-plugin-regional-manager). Its panel starts long-lived regional managers that keep memory in markdown files, plan the work as build or research issues, start an agent on each, set reminders and ask the user on a board; all of one manager's agents are its crew. An agent ends with a handoff; a build issue's done one is reviewed, then verified, unless switched off, and a first failed verdict goes back to the agent; a research issue's carries a report saved to memory. gh watches PRs and CI. The Board lists issues by status. Use when the user asks how to create, start, rename or delete a manager or start an agent, what an issue's kind, status or a verdict means, how verification or CI checks work, what an agent or verifier runs on, why PR status is unavailable, why an agent got findings or an issue returned to Todo, why the thread woke or the board warns of edits, how reminders, decisions or issue links in chat work, where memory lives, or which thread has which tools.
---

# Regional managers

This plugin turns one ordinary bb thread into a long-lived **regional
manager**: it holds a goal, keeps its memory in files, and plans the work as
**issues**. It starts an **agent**, a child thread, on each issue to do the
work; all of one manager's agents are its **crew**. It has no CLI commands
and no plugin settings. Its one setting belongs to each regional manager: the
**Verify done handoffs** switch (see [Verification](#verification)).

## Start one

1. Open the plugin's panel in bb's navigation rail.
2. Press **New** in its title bar.
3. Under **New regional manager**, give it a **name**, an optional
   **description**, and keep, shuffle or pick its **avatar** (see
   [Profile](#profile)).
4. Press **Create**. It saves the regional manager, with no thread yet, and
   opens its page. A create with no name is refused: the name field says
   "Give it a name." and takes the focus.
5. Its page shows its profile, then bb's own new-thread composer, asking
   "What should <name> get done?". It starts with your first project (in the
   sidebar's order) in a fresh worktree of the default branch, so a stray edit
   never lands in your checkout, on **auto** permissions, so no approval holds
   the thread. Every picker works as in any new thread: project, environment,
   base branch, model and reasoning, permission mode, attachments.
6. Type the goal and send it. That starts the regional manager: its thread,
   titled with its name, on exactly what the composer shows, with the goal as
   its first message, which the plugin also writes to `GOAL.md` exactly as
   you typed it. The thread opens. Sending again, or twice at once, starts no
   second thread.

Until its goal is sent, a regional manager has no thread: nothing wakes or
polls it, it has no memory files yet, and bb's sidebar doesn't list it. Its
done handoffs are verified from the start; switch that on its board (see
[Verification](#verification)).

A regional manager that version 0.3.0 created is upgraded by its thread's
user messages, not by whether its thread ran. If its only user message is
0.3.0's placeholder ("Type this regional manager's goal below to start it."),
even one sent and run, it becomes one not started yet, named as its thread
was titled: the plugin empties that thread's queue and archives it. Send its
goal from its page. One with a real message from you keeps its thread and
role; if it has no `GOAL.md`, your first message there becomes it, and a
placeholder still queued is taken out. One whose thread never came becomes
one not started yet, named "Regional manager". An upgrade that fails, say
while bb restarts, is tried again on the next minute's tick.

The panel lists the regional managers not started yet under **Not started**,
then every other one bb still lists under its project, newest first. A row is
the manager's avatar, its name and, below them, its description, and nothing
else. It opens the manager's page, with the composer for its goal, until it
starts, and its thread after; an old link to a started manager's page opens
its thread too. An archived or deleted thread drops its manager off the list.

## Profile

Each regional manager has a profile: a **name**, up to 80 characters, an
optional **description**, up to 500, and an **avatar**: a still blob, one of
21 shapes in one of Zeron's 12 identity colours, with a friendly face. A new
manager starts with a look no other manager has while one of the 252 is free,
picked as Create saves it, so it can differ from the preview New shows;
**Shuffle** picks another such look, and the **Shape** and **Colour** pickers
choose one by hand, even one another manager has.

- **Once it starts, the name is the thread's title.** bb keeps it; the
  plugin stores the description and the avatar. Renaming the thread in bb's
  sidebar renames the manager in the panel too, and an edit of the name
  renames the thread. The thread shows the name as its title, and the
  manager's avatar and name above its composer, never its description. Before
  the start the plugin keeps the name, and the thread is titled with it.
- **Edit it**: before the start, **Edit** on its page in the panel opens the
  name, description and avatar pickers in place; after it, pressing the
  manager's avatar and name above its thread's composer opens them below that
  row. **Save** keeps them, and **Cancel** drops the edit; both close it, and
  the focus goes back to what opened it. Esc closes an edit only while
  nothing in it changed. What you typed in an edit survives bb redrawing it
  and a reload: on the page the edit stays open, and above the composer it is
  there again when you open the editor. A save of a started one renames the
  thread first, so one bb refuses changes nothing. bb's title bar names the
  manager whose page is open.
- **Delete** sits in the Edit form of a regional manager not started yet,
  since bb can't archive a thread it doesn't have. It asks "Delete it?" once,
  in place, then removes the manager and goes back to the list. A started one
  is removed by archiving or deleting its thread in bb.
- **A rename never changes the avatar**: it is stored once, never taken from
  the name.
- **Managers created before avatars were blobs** each get a look of their
  own, taken from their id, as the plugin loads; no two get the same one while
  a look is free.
- **Managers started before profiles** have no description; their name is
  the title their thread already had.
- The New page keeps what you typed in the profile's fields until Create
  saves them.

## Tools

Each role gets its tools from the plugin's own database, so editing a
thread's metadata grants nothing. A call from any other thread is refused,
and no tool can turn verification on or off.

| Tool | Thread | What it does |
| --- | --- | --- |
| `crew_catch_up` | regional manager | Returns every update since its last catch-up, whole, then the board with what blocks each issue and what each blocks, and the issues ready to start, the questions still waiting, its reminders, and its core memory files with their versions. |
| `crew_memory_read` | regional manager, agent, verifier | Reads one memory file, such as `NOTES.md` or `notes/api.md`, with its version. |
| `crew_memory_write` | regional manager | Writes one memory file whole, naming the version it read (null to create one); a stale write returns the current text instead. |
| `crew_remind` | regional manager | Sets a reminder (`note`, `at`, optional `every`) or cancels one (`cancel`). |
| `crew_ask_user` | regional manager | Puts a one-line question, with up to five options, on its board, optionally naming the issue it is about: the question and its answer are then among that issue's decisions. |
| `crew_end_turn` | regional manager | Ends a turn that changes nothing for you, with a one-line `reason` and no reply; its result repeats the reason. It doesn't stop the thread. |
| `issue_create` | regional manager | Files an issue: `kind`, `title`, `description`, and optionally `brief`, `doneCriteria`, `status` (todo or backlog), `verifier`, `parent` and `dependsOn`. |
| `issue_update` | regional manager | Changes an issue's kind (until an agent has started on it), title, description, brief, done-criteria, verifier, parent or dependencies, or rests, cancels or accepts it with `status`; with `decision`, alone or with the rest, records what was decided about it and why. |
| `issue_read` | regional manager | Returns one issue whole: status, what blocks it, plan, its parent and sub-issues, what it depends on and blocks, its decisions, verifier, its agents and what they ran on, every handoff with its verdict, and its agent's latest answer. |
| `agent_start` | regional manager | Starts an agent on an issue, optionally naming its `execution` and `placement`; on an issue that has or had one, hands it over: continuing in the previous agent's environment, moving the work to a new one on a branch cut from its branch when a `placement` is named or that environment is gone, or starting clean with `from: "default"`. |
| `agent_message` | regional manager | Messages one agent, marked as from the regional manager. |
| `agent_stop` | regional manager | Stops one agent, and archives its thread with `archive: true`. |
| `agent_handoff` | agent | Ends the agent's work: done (a build issue's with its commit, a research issue's with its report), blocked or gave up, with a summary and its lists. |
| `issue_verdict` | verifier | Returns each criterion's result and evidence, and findings, for the handoff it checks. |

The regional manager also gets its rules (call `crew_catch_up` first every
turn, never edit project files, build or commit itself, delegate with a
brief and done-criteria) and the `regional-manager` skill, its playbook. An
agent gets the `agent-work` skill and a verifier the `verifying` skill. A
memory file name that leaves the memory folder or doesn't end in `.md` is
rejected.

## Issues

An issue is one piece of the work, filed with `issue_create` and numbered
`BBP-1`, `BBP-2`… within its regional manager (an id is never reused). It has a
kind, a title, a description for you, and before an agent can start, a brief
and its done-criteria. The kind is one of two, and can change only until an
agent has started on the issue:

- **Build**: code on its own branch, checked by a verifier against 1 to 12
  done-criteria, each checkable by running something.
- **Research**: a probe, spike, investigation or design whose result is a
  report. Its done-criteria, 0 to 12, are the questions the report answers,
  and nobody judges them. Nothing verifies it: naming a verifier on a research
  issue is refused, and so is making an issue that names one research. Its
  agent's done handoff carries the report and names no commit, and the
  plugin saves the report in the manager's memory (see
  [Research reports](#research-reports)).

An issue's status is derived from what its agents did, never stored:

| Status | When |
| --- | --- |
| Backlog | No agent holds it, and the manager rested it here: not planned yet. |
| Todo | No agent holds it, ready to start. A new issue rests here, and returns here when its agent ends before its work reached Reviewing (on a research issue, Done). |
| In progress | An agent holds it: working, starting, idle without a handoff, fixing its verifier's findings, blocked, gave up, or its last turn failed. |
| Reviewing | A build issue: its agent handed off done, and an independent reviewer reviews its diff before its verifier starts (see [Review](#review)). |
| Verifying | A build issue: its review is in, or none could be had, and the verifier checks it, or every criterion passed and it waits for CI. |
| In review | A build issue: its done handoff passed ("✓ Verified"), or was made with verification off ("Unverified"). |
| Done | A build issue: its pull request merged ("Merged #41"), or the manager accepted it; final. A research issue: its agent handed off done ("Handed off: <summary>"); a message to that agent makes it In progress again until its next handoff. |
| Canceled | The manager canceled it. |

**Needs you** is a flag on an open issue, shown above every status: its agent
is blocked or gave up, waits for your answer or approval in its thread, its
last turn failed, its work failed verification after its fix round ("✗ Failed
verification after its fix round", "✗ CI failed on #41", or "✗ Not the claimed
commit on a clean tree" when the plugin's own read failed it), its findings
may or may not have reached it, it couldn't be verified, bb never confirmed starting
its agent's thread ("No thread: bb never confirmed starting one": the manager
ends that agent with `agent_stop`, which ends it at once, and starts another
with `agent_start`), or one of the manager's open decisions names it.

The manager sets a status in only four ways, with `issue_update`: `backlog`
or `todo` rests an issue no agent holds (and reopens a canceled one),
`canceled` closes one no agent holds (a parent once its sub-issues are
closed), and `done` accepts one In review, even
while its agent still holds it (a research issue is never In review, so never
accepted: its done handoff makes it Done). Any other change, or `backlog`, `todo` or
`canceled` while an agent holds the issue, is refused naming why.

### Sub-issues

An issue can have sub-issues, one level deep: the manager files them with
`parent` on `issue_create`, or moves an issue under a parent with
`issue_update` (`parent: null` makes it top-level again). A sub-issue of a
sub-issue, and a parent for an issue that has sub-issues, are refused. A
parent is a container: it never has an agent (`agent_start` on it is
refused), and an issue an agent holds can't be split until that agent is
stopped. A build parent holds build and research sub-issues; a research
parent holds research ones only, so a build sub-issue under it, or making a
parent research while it holds one, is refused.

A parent's status rolls up from its sub-issues, derived like any other:

- While a sub-issue is open: In progress once any has started, Todo while
  any is in Todo or the manager rested the parent there, else Backlog. Every
  sub-issue canceled leaves the parent where the manager rested it.
- Once every sub-issue is closed and at least one is Done: a research parent
  is Done. A build parent gets its final check once every Done build
  sub-issue's pull request merged (see [A build parent's final
  check](#a-build-parents-final-check)). A build sub-issue the manager
  accepted unmerged flags the parent Needs you ("BBP-3 isn't merged, so BBP-1's
  work isn't all on the default branch"); the plugin keeps reading that pull
  request, and its merge clears the flag.

A flagged sub-issue flags itself, not its parent. A parent is canceled only
once its sub-issues are closed, and a closed parent takes no new sub-issue.
A parent's dependencies block each of its sub-issues. The manager's catch-up
lists each sub-issue under its parent, and a flagged one under Needs you too,
as the board shows them (see [The board](#the-board));
`issue_read` names an issue's parent and sub-issues.

### A build parent's final check

A build parent's own done-criteria are checked on the default branch once
all of its work is there. Once every sub-issue is closed and every Done build
sub-issue's pull request merged, the parent is Verifying, "Final check due",
and within a minute the plugin starts a hidden verifier, a child of the
regional manager's thread, in a fresh worktree on the manager's machine of
the default branch bb named when the check was made, asked for as
`origin/<branch>`. bb fetches it first, so the worktree starts at origin's
tip even when the local branch is behind, and on that branch even if bb's
default changed since; the check is made only after the merges it waits for
were read. The parent reads "Final check
running". The verifier gets the parent's criteria and description and no
commit: when it returns its verdict, the plugin reads its worktree through
bb's git plugin and judges the commit it holds then, on a clean tree, so a
file it changed or added there fails the verdict. A worktree the plugin can't
read ends the check without a verdict. A check superseded before it returned,
as when an agent was started on the parent while it had no sub-issues, judged
nothing: once the parent's work is all merged under it again, a new one is
due.

It runs on the parent's named verifier when bb lists it on the manager's
machine and no agent that held a Done build sub-issue of the parent ran on
it; else on the manager's model unless one of those agents ran on it; else on
another available provider's default model; else on one of theirs, which the
verdict says. Naming a verifier while a check runs applies to the next one.
It is nudged once if it ends a turn without a verdict, as any verifier is,
and could-not-run after that; its asks are declined and a 30-minute silence
ends it, as for any verifier.

- **Passed**: the parent is Done ("✓ Final check passed"), closed by that
  check, and any issue waiting on it is unblocked, once.
- **Failed** or **couldn't run**: the parent is In progress and Needs you
  ("✗ Final check failed", "Couldn't run its final check, as <the reason>"). Nothing goes back
  to any agent, and there is no fix round: the manager files the fix as a new
  sub-issue, which puts the parent In progress, and once that sub-issue is
  Done and merged a new final check starts by itself. A check never runs
  again without new merged work: a research or canceled sub-issue changes
  nothing on the default branch.
- **Verification off** when it comes due: no verifier starts. The parent is
  In review, "Unverified: verification was off", for the manager to accept.
  A check already running when verification is switched off still finishes.
- A verdict that returns after a sub-issue was filed under the parent, or the
  parent was closed, is kept, as a round in its tab, and places it no more; the
  manager's catch-up says where the parent stands now, from the same view the
  board shows.
- A build parent with no done-criteria when its check comes due Needs you
  ("BBP-1 has no done-criteria for its final check"), and none starts until
  criteria are written. With no default branch on record in bb, none starts
  and the parent stays "Final check due". A research parent never has one.

The manager is woken with `BBP-1 "Card vault" final check: failed` (or passed,
could not run, not run, verification is off), which quotes nothing;
`crew_catch_up` and `issue_read` print the verdict whole, with the default
branch and commit it judged and which model it ran on ("as named on BBP-1", or
"a3's own model, as no other was available"). Each final check stays a round
in the parent's tab. After its verdict, the verifier's thread and its worktree
are left as they are, for the user to open from the verdict; they go when the
regional manager is archived, as its children.

### Dependencies

An issue can depend on others (`dependsOn` on `issue_create`, added and
removed with `issue_update`), seen from the other side as "blocks". It is
**blocked** while one of them, or of its parent's, is not Done or Canceled: derived on every read
from the same statuses the board shows, never stored, so it can't go stale. A
research dependency closes with its report and reopens when its agent is
messaged, and its dependents are blocked again until the next report. A
dependency on an issue the manager doesn't have, on the issue itself, or that
would close a cycle is refused, naming the cycle (`BBP-1 → BBP-3 → BBP-2 → BBP-1`); a
cycle through a parent counts, since a sub-issue waits for its parent's
dependencies and a parent for its sub-issues.

Dependencies inform and never refuse: the manager decides what runs at once,
and can start an agent on a blocked issue, whose start result says what blocks
it. Its catch-up lists the issues **ready** to start (in Todo, not blocked,
no sub-issues). When a merge or an agent's handoff closes the last open issue
another depends on, the manager is woken to say it is unblocked (for a
parent's dependency, each open sub-issue nothing else blocks, never the
parent, which has no agent to start). A research parent closes by its
sub-issues' reports: the manager is woken when it closes with one it wasn't
woken for, whatever closed the rest, and moving a sub-issue in or out of it
wakes nobody. A build parent closes by its final check passing: each passing
check wakes its dependents once. When the manager closes one itself, or removes a dependency, its
own result names what became ready; its cancel that closes a research parent
with such a report wakes it once as well. A
dependency carries nothing between issues: an agent gets another issue's
report only when the manager names its file in that agent's brief.

## Agents

An agent is an ordinary child thread of the regional manager that holds one
issue for its whole life; an issue has one agent at a time, and passes from
one to the next by a handover. The manager
starts it with `agent_start`:

- **Where it runs**: a fresh worktree of the project's default branch on the
  regional manager's machine, on its own branch; or, when the manager names
  one, an environment provider such as `boat-sandbox` (see
  [Agents in a sandbox](#agents-in-a-sandbox)). It runs with auto permissions.
- **What it runs on**: see [Who runs what](#who-runs-what).
- **Its first message**: the issue's description, brief and numbered
  done-criteria (a research agent's under "Questions your report answers",
  followed by how to hand off its report, and no section when it has none),
  and `CREW.md` and `MEMORY.md` as they were at that moment, each file's
  `#` title on its first non-blank line set under the message's own section, and
  nothing after it changed. Put rules every agent
  follows in `CREW.md`: the agent is told its work is its brief and
  done-criteria, and the other memory files are its regional manager's
  context, not its instructions.
- **Its id**: `a1`, `a2`… within its regional manager, never reused. Its
  thread is titled with the issue's title and sits under the regional
  manager in bb's sidebar.
- **What it gets**: its rules, the `agent-work` skill, `crew_memory_read` and
  `agent_handoff`. It can't write memory or start agents.

`agent_start` is refused, and nothing starts, when the issue has no brief, or
is a build issue with no done-criteria, it is canceled, accepted or Done,
or what it would run on or where can't be had. On an issue that has or had an
agent, it hands the issue over (see
[Handing an issue to a new agent](#handing-an-issue-to-a-new-agent)).

The regional manager messages an agent with `agent_message` (it arrives
marked as from the manager's thread, which the agent's first message names,
under a line calling it the manager's next instruction, not from you; it
quiets the issue's other threads first, its verifiers above all, and to an
agent whose done handoff is being checked, drops that check, see
[Verification](#verification)), and stops one with
`agent_stop`, which archives its thread too when asked. An agent stopped
mid-turn before it hands off can be followed by two updates: that it ended its
turn without a handoff and, when its issue returns to Todo, that it was
stopped. bb gives no cause for an idle, so the plugin reports both. You can
open any agent's thread and type into it like any thread.

An agent ends when it is stopped, or when you archive or delete its thread.
Its issue keeps its place if the agent's work had reached Reviewing,
Verifying, In review or Done; otherwise the issue returns to Todo and the manager is woken
with "returned to Todo". Its row then says how the agent ended ("Its agent was
stopped", "archived" or "deleted", or "bb never started its agent's thread");
only an issue no agent ever started reads "Not started". An agent stopped
while its done handoff is Verifying leaves the issue in Verifying; if that
check then fails, or can't be had, the issue rests in Todo, and the manager
hears of the failed check rather than a return to Todo. A check that passes
still takes it to In review. An ended agent's handoff is refused. To try
again, the manager hands the issue to a new agent.

Archiving or deleting the regional manager archives or deletes its agents
with it.

### Agents in a sandbox

`agent_start` with `placement: {"kind": "provider", "environmentProviderId":
"boat-sandbox"}` starts the agent on a new machine from that environment
provider, here a boat sandbox with the project cloned and a new branch made
from its default branch, which bb names and records, so the agent works on
its own branch from the start, as a worktree agent does. `machineInputs` sets
that machine's inputs, such as `{"preset": "small"}` for a small boat sandbox;
`bb environment providers --json` lists each provider's. Without them the
provider's defaults apply. The plugin checks the provider with bb first: one
bb doesn't have, one that needs inputs the plugin can't give, or
`machineInputs` for one that makes no machine, is refused and nothing is
saved, and so is one that needs a new branch when bb records no default
branch for the project.

- The agent's tools run on the bb server, so `crew_memory_read` and
  `agent_handoff` work from the sandbox as from any machine.
- The plugin never reads the sandbox just to learn the agent's branch, since
  a read could wake it or keep it from idling: the branch is the one bb made,
  until the agent hands off on another.
- Its verifier runs in the same sandbox, on the agent's own checkout.
- A sandbox removed before its verifier returns a verdict leaves the issue
  under Needs you as "Couldn't verify, as <the reason>".
- `agent_stop` with `archive: true` destroys the sandbox when no other thread
  lives there, with anything the agent never pushed.

### Handing an issue to a new agent

An issue outlives its agent: `agent_start` on an issue that has or had one is
a handover, and the issue keeps one record of every agent, handoff and
verdict.

- **The holder** is stopped and ends as "replaced", never archived: a stopped
  thread keeps its environment alive, since bb destroys a sandbox within
  seconds, and retires a worktree a few minutes later, once no live thread is
  left in it. First the manager's messages and the verifiers' findings still
  queued for any of the issue's agents, the holder or one the manager
  stopped, and the plugin's reminders queued for its verifiers (sent as from
  the manager's thread), are taken back, each confirmed gone by reading bb's
  queue again; the result quotes the manager's, naming the agent that never
  got each. One that can't be taken back, or that the user queued for an
  agent or a verifier, refuses the start: once sent, it would wake that
  thread beside the new agent. Then
  every live thread the plugin started on the issue (the holder, a verifier,
  an earlier agent) is stopped, never archived, idle or not: bb's stop also
  ends a background command a turn left running, whose finish would
  otherwise start a new turn there. `agent_stop` stops an idle thread the
  same way. A late
  verdict is refused. Until bb confirms each stopped, the start is refused and
  the holder keeps the issue. Every check of the issue still waiting is
  superseded; a verdict that passed and waits for CI is kept whole, marked
  superseded. Nobody is woken: the manager did it.
- **One at a time**: everything that acts on one issue (a start or handover,
  `agent_stop` and its archive, `agent_message`, a handoff, a verdict, a
  verifier started, reminded or given up on, findings sent to an agent, an
  agent ended as its thread was archived or deleted) runs one after another,
  and each reads what it decides on once it is its turn. A turn lasts until bb
  answers it, however long that takes. A tool call that waited about 30
  seconds is refused, having changed nothing, and can be called again; the
  minute's pass never waits, and skips a busy issue until the next minute.
  Before a verifier starts, the issue's other threads, the agent whose
  handoff it checks and every other verifier, are quieted (see
  [Verification](#verification)); while they aren't, it stays queued for the
  next look or minute. An agent and its own verifier never run together.
- **By default the new agent continues** in the previous agent's environment,
  a worktree or a sandbox alike, as the verifier joins it: the same
  checkout, branch, commits, uncommitted files and pull request. A suspended
  sandbox is woken by the start, and nothing reads it before. A worktree whose
  thread you archived is still joined within the few minutes bb keeps it.
  The pull request stays the issue's, with no second "opened" update, and its
  merge makes the issue Done.
- **A placement named moves the work** to a new environment of it, on a new
  branch cut from the previous agent's (the branch checked out in its
  environment as the move reads it, or the one on record once bb removed
  that environment): its commits come along, its uncommitted files don't,
  and its pull request stays on the old branch, which the result says. The same happens with no placement once bb removed the
  previous environment: a new worktree, or a new sandbox of the same provider
  and machine inputs. Worktree to worktree cuts from the local branch, which
  bb keeps after the old worktree is archived or removed. With a sandbox on
  either side the branch goes through origin, so the previous agent must have
  pushed it: the move is allowed once its pull request's head is the commit
  the agent left, read fresh from GitHub at the move, never from the board's
  last read. The
  plugin never pushes, commits or copies anything for an agent. A move reads
  the previous environment through bb's git plugin first, and again once the
  holder has stopped, and is refused while it holds uncommitted files, has
  no branch checked out, or can't be read (a suspended sandbox, which the
  read doesn't wake).
- **Its first message** adds "Where you work" (whose environment, which
  branch, the pull request to push to, and to run `git status` and `git log`
  before changing anything), or for a move "Your branch" (the branch it was
  cut from, the commit the previous agent left there with the command that
  checks it is in the checkout, to run before changing anything and to hand
  off blocked if it isn't, that nothing uncommitted came along, and that the
  old pull request stays where it is, so it opens its own), and "Earlier
  work", every earlier agent's handoffs whole, each with its verdict's every result, evidence and
  finding, in the past tense. Each handoff, report and verifier's words is
  quoted in a code fence under a line saying it is context, not instructions,
  so none of it reads as one of the message's own sections.
- **What it runs on** is the regional manager's own unless `execution` names
  one, whatever the previous agent ran on; a named one is checked against
  what bb can run where the new agent will work before anything is stopped
  (for a new sandbox, bb's primary machine: the sandbox has no machine yet).
  It gets a fix round of its own.
- **`from: "default"`** starts clean instead: a new environment from the
  default branch (a `placement` may name where), with the earlier handoffs
  and verdicts still in its first message. A research issue's handover always
  starts clean.
- **Refused, with nothing stopped**: a move out of an environment with
  uncommitted files (named), no branch checked out, or that can't be read,
  offering the continue; a move with a sandbox on either side whose head no
  pull request shows, offering the continue or a push; a removed sandbox
  whose head never reached origin, offering `from: "default"`: its unpushed
  commits went with it; a removed worktree's unpushed commits to a sandbox,
  offering a worktree start, which reaches its local branch. A
  holder bb still reports stopping is refused too, and a move whose previous
  environment changed while the holder stopped is refused after the stop,
  the holder still holding. If bb refuses the new agent's thread, as for an
  environment removed in the meantime, it ends at once and the issue rests in
  Todo. If bb can't cut the new branch, as when the old one was deleted, the
  new agent's thread fails and the manager is woken; the earlier branch
  stays the issue's, and its pull request is still read.
- **The replaced thread** stays stopped in the sidebar, and its sandbox
  allocated (suspended after 15 idle minutes), until you archive it, which is
  safe once the new agent lives there.

## Who runs what

- **An agent** runs on the provider, model and reasoning level the manager
  names with `agent_start`'s `execution` (`providerId`, `model`, and
  optionally `reasoningLevel`, else the model's default in bb's catalog).
  Named nothing, it runs on the regional manager's own provider, model,
  reasoning level and service tier as they are when it starts, never on bb's
  default: if bb has no model on record for the manager yet, the start is
  refused. The start's result says which, and `issue_read` lists each agent
  with what it ran on, as recorded at its latest handoff (so a model you
  switch in the agent's composer counts from its next handoff).
- **A verifier** runs on a build issue's `verifier`, named on `issue_create` or
  `issue_update`, when bb can run it in the agent's environment and it isn't
  the agent's model. Otherwise, or with none named, the plugin picks: the
  regional manager's model, if the agent runs on another; else the default
  model of another provider bb can run there; else another model of the
  agent's provider; else the agent's own, which the verdict then says.
  `verifier: null` gives the choice back to the plugin. A change applies from
  the issue's next done handoff; a check already running keeps its own.
- **Refusals**: an unknown provider, one bb lists as unavailable there, or a
  model its catalog doesn't list is refused before anything changes, naming
  what bb can run there (providers it lists as available and can load the
  models of) and, for a known provider, its models. A verifier on
  the model of the agent holding the issue is refused, and so is an agent on
  its issue's verifier; each refusal offers the other change.
- **Your choices**: tell the regional manager once, such as "build on codex
  gpt-5.4, verify on claude-code opus". Its rules keep it in
  `RULES.md` and name both on every issue and agent it covers. The
  board shows no model names; the manager's `crew_catch_up` and `issue_read`
  do.

## Proposing work

Tell the regional manager to propose work and wait for you, and it files the
issues in Backlog and describes them in one decision on its board (see
[Decisions](#decisions)), starting no agent. Its rules tell it to do this
whenever you asked it to propose and wait, or `RULES.md` says so. Your
answer wakes it, and it starts agents on the issues you agreed to, changed as
you asked.

## Handoffs and updates

bb's own report to the parent is off for agents. Instead, an agent ends its
work with `agent_handoff`, and the plugin records everything it sees:

- **A handoff**: `done` (a build issue's with the commit, required, and a
  pull request link if there is one; a research issue's with its report,
  required, up to 20,000 characters, and no commit), `blocked` or `gave-up`; a one-line summary (up to 120
  characters); and what it did, its evidence, concerns, deviations and
  findings (up to 50 items each, each up to 2,000 characters). It is stored
  whole.
- **An agent failed**, with bb's error.
- **An agent waits on the user**: a question or an approval in its thread.
- **An agent ended a turn without a handoff**, with its last answer.
- **An issue returned to Todo**: its agent was stopped, archived or deleted
  before its work reached Reviewing.
- **A build parent's final check is over**: passed, failed, could not run,
  or not run as verification is off (see [A build parent's final
  check](#a-build-parents-final-check)).
- **An issue was unblocked**: a pull request's merge, an agent's handoff or
  a final check that passed closed the last open issue it, or its parent,
  depends on (see [Dependencies](#dependencies)).
- **An issue's pull request changed** (see
  [Pull requests and CI](#pull-requests-and-ci)): it opened, reopened, merged
  or closed, its CI passed or failed, or a review approved it or asked for
  changes. A new CI run starting is not an update.
- **The user saved a memory file** under Memory in the manager's Board tab. The thread's own
  writes don't count.
- **The user turned verification on or off.**
- **One of the thread's reminders came due** (see [Reminders](#reminders)).
- **You answered one of its decisions** (see [Decisions](#decisions)).
- **Its own turn ended with changed files in its working tree** (see
  [Edits it makes itself](#edits-it-makes-itself)), or with the tree clean
  again after that.

A build issue's `done` handoff is announced only together with its verdict
(see [Verification](#verification)); everything else at once, a research
issue's done handoff included, as `- BBP-2 "Pick a card vault" (a2) handed off:
done`. `crew_catch_up` then prints its report whole with the file it was
saved to.

Each one wakes the regional manager with one short message: the plugin's
name in brackets, how many updates there are, and one line each, naming the
issue and its agent, such as
`- BBP-1 "Add retries" (a1) handed off: done, failed verification`,
`- BBP-2 "Dead letters" (a2) handed off: blocked`,
`- BBP-1 "Add retries" (a1) PR #41: CI passed`,
`- BBP-3 "Metrics" (a3) returned to Todo: its agent was stopped`,
`- BBP-4 "Card vault schema" is unblocked: BBP-2 done`,
`- The user edited NOTES.md`, `- Your reminder r1: check on BBP-1`,
`- The user answered your question d1: Target main or release/2?` or
`- Your own environment has 2 files changed after your turn: hand the change to an agent`.
The tree being clean again, like a fix round sent back, wakes nobody: it is
listed in the next message and catch-up.

The message is hidden from you: bb shows no message for it, only the turn it
starts. Once that turn ends, it folds into bb's "Worked for" row, when
Settings has Collapse finished turns on for the manager's provider; expand
the row to see the manager's catch-up. The manager still reads the message
as if you typed it, so it holds only facts the plugin derived and what the
thread wrote itself (its issues' titles, its reminders' notes and the
questions it asked you): never an agent's summary, answer, error or
question, a verifier's evidence, nor your answer to a decision. Those are in
`crew_catch_up`, which returns every update since the last catch-up, whole,
once.

The message never interrupts a running turn: it waits in the thread's queue
until the turn ends. While one waits, the next updates wait for it to be
sent, then get a message of their own. Once `crew_catch_up` has returned
every update, a message still waiting in the queue is taken back, so the
thread isn't woken for updates it has read. A send that fails is retried by a
once-a-minute tick, which also forgets a waiting message bb no longer holds.
If bb gives up sending a waiting message (its retries spent), the tick takes
it out of the queue and sends what it announced again.

## Review

While verification is on, every `done` handoff of a build issue is reviewed
before its verifier starts. The plugin starts a **reviewer**:

- **Where and when**: a hidden thread, a child of the agent's thread, in the
  agent's own environment, once the agent's turn that handed off has ended,
  with the issue quieted first, as for a verifier (see
  [Verification](#verification)). It never edits, commits or pushes.
- **On what model**: never the agent's, and, while bb runs another there,
  not the one the verifier is then chosen on either, so the verifier's
  triage is independent; with no third model, the verifier's. When bb runs
  nothing there but the agent's own model, no reviewer starts: the review is
  missed as having no independent reviewer model.
- **What it runs**: what CREW.md tells reviewers to run. The plugin names no
  review of its own. Its first message is the plugin's one line ("Review
  this diff as CREW.md instructs reviewers, and report through
  issue_review."), the diff (the claimed commit against origin's default
  branch, and the pull request when the agent named one), the issue's brief
  and done-criteria, and CREW.md whole, as agents get it.
- **What it reports**: `issue_review`, its findings, each with its file, its
  line, a severity (must-fix, should-fix or nit) and its claim; `[]` when it
  found nothing.
- **The issue** is Reviewing meanwhile ("Reviewing: <summary>"), between In
  progress and Verifying, and Verifying once its review is in.
- **It never holds the issue**: a reviewer bb won't start, whose thread is
  gone, that ends its turn without reporting, that shows no activity for 30
  minutes, or that asks something bb won't let the plugin decline ends the
  review as missed, and is stopped. Its verifier starts at once, told no
  review was had, and the verdict says so. Anything it asks a person is
  declined, as a verifier's is.
- **Triage**: the verifier's first message lists the findings, numbered, as
  claims to check; its verdict confirms or rejects each, with a reason in a
  line. The manager's update lists the confirmed ones and the rejected ones,
  each with its reason; a failed verdict that goes back to the agent carries
  only the confirmed ones. A confirmed finding alone doesn't fail the
  verdict: the done-criteria decide it.
- A check made before reviews existed has no review: its verifier starts as
  before.

## Verification

Every `done` handoff of a build issue claims an exact commit. A research
issue's names none and is never verified: no verifier starts, and the plugin
reads nothing of the agent's environment. While a regional manager's
**Verify done handoffs** switch is on (the default), the plugin itself starts
a **verifier** for each one:

- **Where**: a hidden thread, a child of the agent's thread, in the agent's
  own environment. Archiving the regional manager takes it along.
- **When**: once the agent's turn that handed off has ended. An agent and its
  own verifier never run at the same time in that environment: a verifier
  starts, or is reminded, only while bb reports its agent idle, and its
  findings go back only once bb reports it no longer running. Each time the
  environment changes hands (a handover, a verifier starting, a verifier
  reminded, findings going back, the manager's message), every other thread
  of the issue is quieted the same way first: what the plugin queued for it
  in bb (the manager's messages, findings, reminders) is taken back and
  confirmed gone by reading bb's queue again, then it is stopped, idle or
  not, and confirmed stopped. bb's stop ends a command a turn left running in
  the background, whose finish would otherwise start a new turn there by
  itself, and a message left in bb's queue would be sent as the turn stops.
  Two things are never taken back: a message the user queued, and, while the
  agent keeps the issue, what is queued for it (the manager's message or
  findings, its next work). Either keeps a verifier from starting or being
  reminded until bb has sent it, and refuses a handover or the manager's
  message until bb has sent or deleted the user's. A reminder taken back
  comes again at a later look; findings left owed go once the verifier is
  quiet. Stopping the idle agent ends nothing of its work: its done handoff
  stands, the issue stays Verifying, and the manager hears of no stop. bb
  saying a thread went idle sets it off; the once-a-minute tick catches one
  the plugin missed.
- **On what model**: the issue's named verifier first (see
  [Who runs what](#who-runs-what)), never the agent's model while bb has
  another.
- **The commit and the tree**: the plugin checks them itself, not the
  verifier. As the agent hands off, it reads the agent's environment through
  bb's git plugin on its machine: HEAD must be the claimed commit, on a clean
  working tree. The verifier is given that read, labelled as the plugin's,
  and is told not to judge them again: a provider's per-command sandbox can
  show files the agent's tree doesn't have. When the read is wrong (another
  commit, or changed files), the verdict fails with it as evidence, shown
  above the criteria, and goes back to the agent like any first failure. When
  bb's git plugin can't read it (the plugin off, the machine unreachable, not
  a git repository), no verifier starts: the issue reads "Couldn't verify"
  under Needs you with the reason, and no fix round is spent.
- **What it does**: runs what proves or disproves each done-criterion and
  quotes the output. It never edits, commits or pushes, and it gets none of
  the agent's own report, only the issue's brief and criteria. It ends with
  `issue_verdict`: each criterion `pass`, `fail` or `unverifiable`, with its
  evidence, and any findings. A criterion it can't check as it is written,
  as one naming a step that hasn't happened yet, is unverifiable, never
  passed on a nearby fact. A verdict that skips, repeats or invents a
  criterion is refused.
- **Outcome**: derived, never stored. Verified only when the commit and the
  tree were as claimed, every criterion passed, and CI didn't fail on the
  commit when the issue has a pull request; an unverifiable criterion is not a
  pass. The manager's catch-up says which model checked it and why, as in
  "on claude-code opus, as named on BBP-1".
- **Nobody answers a verifier**: anything its provider asks a person (a
  question, an approval, an MCP connector's sign-in) is declined as bb raises
  it, or at the next tick if the plugin missed it: an approval is denied, a
  question answered that nobody answers a verifier, a provider's own request
  (codex's MCP sign-in) declined. The verifier goes on without it, and its
  verdict's findings name each ask declined. While one is pending the row reads
  "Verifying, its verifier asking for an answer or an approval, which the
  plugin declines". An ask bb refuses to let the plugin decline ends the check
  "Couldn't verify", naming the ask, and stops the verifier. The verifier's
  brief tells it to use the `gh` CLI for GitHub, never a connector or app.
- **No verdict**: a verifier that ends a turn without one is reminded once,
  when its agent is idle;
  a second time, or a verifier bb wouldn't start, whose thread was archived,
  whose environment bb removed, or that showed no activity in bb for 30
  minutes while it ran (the plugin then stops it), reads "Couldn't verify, as
  <the reason>" under Needs you, and wakes the manager. Opening the issue shows the reason and links the
  verifier's thread.
- **A newer done handoff** from the same agent stops the older verifier, and
  only the newer handoff is checked and announced.
- **A verifier that never started** (the plugin reloaded at that moment) is
  started by the once-a-minute tick.
- **A manager's message mid-check**: `agent_message` to an agent whose done
  handoff is still being checked means the manager wants more work, so the
  check is moot. Its verifier is quieted first, as every other thread of the
  issue is before any message (while bb doesn't confirm one stopped, or has
  a message the user queued for one, the message is refused and nothing is
  sent), then the message is
  sent and the check dropped: nothing reports on that handoff, the result
  says so, and the agent's next done handoff is checked afresh. A verdict
  already returned is kept: it goes to the manager, with no fix round, and
  one waiting for CI waits on.

Turn verification off or on with the switch at the top of the board. It is on
when a regional manager is created. It applies to handoffs made after it: turning it
back on doesn't check earlier ones. Each change tells the regional manager.
With it off, a done handoff goes to In review as "Unverified: <summary>".

### One automatic fix round

An agent's first failed verdict (any criterion failed or unverifiable, the
commit or the tree wrong, or CI failed on its commit) doesn't wait for the
regional manager:

- The verdict is stored at once, and the plugin sends the agent's thread one
  message once the verifier's turn has ended, **from the verifier thread**: bb shows it as another thread's message, so the agent never takes
  it for yours. It is headed "Verifier findings" and holds each criterion that
  didn't pass, with the verifier's evidence, the checks that failed when CI
  did, and its other findings.
- The agent starts working on it at once (or after its running turn), so its
  issue is In progress again. It commits, hands off again, and a new verifier
  checks the new commit.
- Until bb has taken the findings, the issue stays Verifying. The verifier,
  and every other thread of the issue but the agent, is quieted before they
  go: a reminder queued for it is taken back, and it is stopped, idle or
  not, so a command it left running in the background can't wake it beside
  the agent. One still running at the next
  minute's tick, its verdict returned, is stopped then, so the findings wait
  about a minute at most; one bb doesn't confirm stopped keeps them waiting,
  and the tick tries again. A reload in between loses
  nothing: the tick sends findings still owed.
- The regional manager has nothing to do, so this alone doesn't wake it. It
  is listed, as in `- BBP-1 "Add retries" (a1) handed off: done, failed
  verification, findings sent back to it (fix round 1)`, in its next wake and
  catch-up.
- An agent gets **one** such round, counted on the agent before the findings
  are sent, and kept across reloads; a new agent on the issue gets its own.
  Its next failed verdict sends nothing back: the issue waits under Needs you
  as "✗ Failed verification after its fix round: <summary>", and the regional
  manager decides: message the agent, ask you, or hand the issue to a new
  one.
- A crash or reload while the findings are sent, or a send that fails in a
  way that doesn't prove bb refused them (a timeout, a dropped connection, a
  server error), leaves no record in bb that shows whether they arrived. They
  are never sent again on a guess: the round stays spent, the issue waits
  under Needs you as "✗ Failed verification, its findings may or may not have
  reached it: <summary>", and the regional manager is woken to decide.
- Nothing is sent back for a handoff that is no longer the agent's current
  one (someone typed to the agent, the manager messaged it, or it handed off
  again before its findings were sent), or for
  an agent that has ended. When bb refuses the message before taking it (the
  agent's thread is archived, deleted or can't take a message), its round is
  given back, and the regional manager's catch-up says bb refused the
  findings, with bb's answer. Either way the verdict goes to the regional
  manager.

## Pull requests and CI

bb tells plugins nothing about pull requests, so the plugin reads them itself,
with `gh` on the machine running bb, on the same once-a-minute tick:

- **What**: each open build issue's newest pull request from its branch,
  and a build sub-issue's the manager accepted unmerged while its parent is
  open (a research issue's branch is never read, so a pull request there
  changes nothing): the branch
  of its latest agent that has one, as that agent had it checked out at its
  latest handoff (read once through bb's git plugin as it hands off), else the
  one bb made its environment on. It is read whether or not that agent's
  thread is still there, so an issue In review becomes Done when its pull
  request merges even after its agent's thread was archived. Nothing else
  reads an agent's environment for its branch. For each, its number, state
  (open, draft, merged, closed), review (approved, changes requested) and its
  CI on its head commit, as GitHub's merge box rolls the checks up (passing,
  failing with the failed checks' names, running, or no checks). A check
  state GitHub adds later counts as running, never as a pass.
- **How often**: one `gh api graphql` call per GitHub repository for all its
  branches. A repository is read every tick while any CI there is running or a
  verdict waits for CI, else every five minutes. A canceled or accepted issue
  isn't read. A branch whose pull request was read merged or closed isn't read
  again until its agent hands off again. Only projects whose git remote is on
  github.com are read.
- **A merge makes the issue Done**, whatever its agent is doing; a check still
  pending or failed then is never sent back.
- **A verdict waits for CI**: a done handoff that passed every criterion, when
  it names a pull request or one is known for the issue, waits under Verifying
  as "Waiting for CI on #41: <summary>" (or "Waiting for CI" before the pull
  request is seen) until CI finishes on the very commit the handoff claims;
  CI on another commit says nothing about it. CI passing makes it verified,
  and it moves to In review within about a minute. CI failing makes it a
  failure, which goes back to the agent as above, naming the failed checks.
  Only then does the regional manager hear of it. A handoff with no pull
  request named or known doesn't wait. No checks on the claimed commit is not
  a pass: right after a push GitHub may not have attached them yet, so it
  waits, follows the checks if they appear, and passes as "✓ Verified, no CI
  checks: <summary>", never as CI passing, only once a read five minutes or
  more after the plugin first saw that commit still finds none. Time passing
  without such a read, or a read that fails, never makes it no CI checks.
- **When it can't read GitHub**, the board says "PR status unavailable:
  <why>", rows keep the pull request and CI read last, and no update is
  recorded. A failure that may pass by the next read (GitHub unreachable, a
  timeout, a rate limit, an answer the plugin can't read, or anything gh
  doesn't explain) says nothing about CI, so a verdict waiting for CI keeps
  waiting and settles on the next read that succeeds. One that lasts until
  someone acts (gh missing, signed out, or holding credentials GitHub
  rejects) makes a verdict that would wait pass as "✓ Verified, CI not
  checked: <summary>". The same goes for a verdict that waits on a pull
  request in a project not on github.com, or one a read begun after the
  handoff found merged or closed before CI finished on the claimed commit.
  Sign gh in with `gh auth login` on the machine running bb; for rejected
  credentials, check `gh auth status` there.

## Reminders

Rather than wait or poll, a regional manager sets itself a reminder with
`crew_remind`:

- **Set one** with a `note` (one line, up to 500 characters, such as "check
  on BBP-1") and `at`, when it first comes due: `"2m"`, `"in 2h"` or `"3d"` from
  now (whole minutes, hours or days), or an ISO 8601 time with its offset,
  such as `"2026-11-16T17:00+02:00"` (the thread can't know the server's time
  zone, so a time without one is refused). Add `every`, such as `"30m"`,
  `"2h"` or `"every 1d"`, to repeat it. A time the plugin can't read, a date
  that doesn't exist (such as `2027-02-29`), or one in the past, is refused
  with the forms it accepts, and nothing is set. It returns the reminder's
  id: `r1`, `r2`… An id is never reused.
- **When it comes due**, the once-a-minute tick wakes the thread with its
  note, as in `- Your reminder r1: check on BBP-1`, within about a minute. A
  one-off is then gone. A repeating one moves to its next time after now, so
  one missed several times while bb was down wakes the thread once, and keeps
  its schedule.
- **See them**: `crew_catch_up` lists every reminder with its id, when it is
  next due and how often it repeats.
- **Cancel one** with `crew_remind` and `cancel: "r1"`. A thread can cancel
  only its own.
- **An archived regional manager** is never woken: its due reminders wait,
  and wake it once bb lists it again, unarchived. A **deleted** regional
  manager's reminders are deleted.

## Decisions

When only you can decide something, a regional manager asks with
`crew_ask_user`: a one-line question (up to 500 characters) and up to five
options (each one line, up to 80 characters, no two alike), or none, and
optionally the issue it is about. It returns at once and the thread keeps
working: the question never waits as a form in its thread, where it would
hold every update meant to wake it. It gets an id: `d1`, `d2`… An id is never
reused.

The decision shows on the board under **Needs you**, above the issues there,
with a button for each option and a field to answer in your own words: Enter
sends it and Shift+Enter breaks the line, and Esc doesn't leave the page while
it has text. A send that fails keeps your text, with the error under it. Text
you haven't sent stays in the browser, through a resize or a reload, until you
send it or the decision is answered elsewhere. An issue the decision names
also waits under Needs you until you answer. Your answer takes the decision
off the board and wakes the thread; a decision that named an issue stays,
with your answer and when you gave it, in that issue's **Activity**, where an
open one's options answer it too (see [The board](#the-board)). The thread's
`crew_catch_up` returns your answer, as the option you chose or in your own
words, with its question. A decision is answered once: a second answer, as
from another window, is refused.

The panel's entry in the navigation rail counts everything under **Needs
you** on every board the panel lists: open decisions and issues alike, the
same rows each board shows there. Its name says which, as "3 need you: 1
decision, 2 issues". It drops as you answer a decision or an issue leaves
Needs you.

An agent's own question or approval stays in the agent's thread, for you to
answer there.

## Edits it makes itself

A regional manager's rules say it never edits project files, builds or
commits. bb can't enforce that (there is no read-only mode, and a plugin can't
take a provider's file tools away), so the plugin **detects** it instead:

- **When**: each time one of the regional manager's turns ends, the plugin
  reads its own environment's working tree through bb's git plugin
  (`bb--git` `status`). Agents' and verifiers' turns aren't read.
- **Changed files** (any modified, added, deleted or untracked file) put a
  warning at the top of its board, under the switch: how many files changed
  in its own environment, when its turn ended, and that it was told to hand
  the change to an agent. The thread is woken with `- Your own environment
  has 2 files changed after your turn: hand the change to an agent`, and its
  `crew_catch_up` tells it to propose, in a decision on its board, an issue
  whose agent redoes the change on its own branch (always: it starts that
  agent only once you agree), and to ask you there whether to discard the
  changes in its environment; or, if you made the changes, to leave them and
  say so in its reply. It never stashes, reverts, checks out or deletes
  anything there, not even its own changes, since you may have edited the
  same files: discarding them is yours to do.
- **Once per state**: a turn that ends with the same number of changed files
  records nothing new and wakes nobody, after a reload too, since the plugin
  compares with the last warning it stored. A different number warns again.
- **A clean tree** at the end of a later turn clears the warning, and its
  next catch-up says the tree is clean again. That doesn't wake it.
- **Nothing is recorded** for an environment outside git, or when bb's git
  plugin can't read it (its machine is offline, or the read fails); the
  warning stays as it was, and the server log says why.
- **It is not a guarantee.** A change the thread committed, or made and
  undid within one turn, leaves the tree clean and isn't seen. The plugin
  never blocks or reverts an edit. The plugin itself writes nothing in the
  thread's environment: its memory files live on the bb server.

## The board

The **Board** tab in a regional manager's side panel shows its board, live,
and ends with its [memory](#read-and-edit-memory):

- **Verify done handoffs**: the switch for this regional manager.
- **Files changed in its own environment**: a warning with how many, and
  when its turn ended, while the latest read of its working tree found
  changed files (see [Edits it makes itself](#edits-it-makes-itself)).
- **PR status unavailable: <why>**, only while the latest read of a pull
  request failed.
- **Lanes**: Needs you, then In review, Verifying, Reviewing, In progress, Todo,
  Backlog, Done and Canceled, each under a bar with its name, how many it
  holds and a chevron, and no glyph: each row draws its own. Pressing the
  bar folds or unfolds the lane; Backlog, Done and Canceled start folded,
  and an empty lane isn't shown. Needs you holds the open decisions put to
  you, then the issues flagged Needs you. An answered decision is on no
  lane: it leaves the board, and one that named an issue stays in that
  issue's Activity.
- **Issues**, each row one line: its status's glyph, its id in mono, in a
  column the ids share, its title, fading out at its end, then its pills
  and, once it has one, its pull request: its number in its state's colour,
  with a dot for its CI, which opens it on GitHub. A flagged issue draws
  Needs you's red glyph in place of its status's, wherever its row is; its
  status is in the row's spoken label, its card and its tab. Under Needs
  you a row adds a second line: what it waits on you for (such as
  "Blocked: <summary>", the agent asking you for something). The row names
  no kind and no agent, and its headline is in its card and its tab. Done
  and Canceled rows read quieter.
- **Pills**, after the title: a parent's sub-issues Done, a ring filling in
  Done's violet with "3/7"; what blocks it, a red ⊘ with the blocker's id
  ("⊘ BBP-6"), or how many when more than one does; and what it blocks, an
  amber →| with how many. What it blocks counts only the open issues that
  depend on it, and only while it is open itself: a Done or Canceled issue
  blocks nothing. A blocked issue stays in its own status's lane: blocked
  is not a lane, and doesn't put it under Needs you. `crew_catch_up` says
  both too: "; blocked by BBP-6 (Todo)" and "; blocks BBP-7 (Todo)".
- **Its card**: rest the pointer on a row for half a second, or move
  keyboard focus to it, and its card opens under it, or above it when the
  panel has no room below (a card too tall for either side scrolls inside,
  and Tab moves into it to scroll it from the keyboard; Escape there closes
  it and puts focus back on its row):
  its title whole, up to
  three lines; its status, and its agent; what it waits on you for, or else
  its headline (such as "Working", "Verifying: <summary>" or "✓ Verified:
  <summary>"); its pills spelled out ("3 of 7 done", "Blocked by BBP-6",
  "Blocks BBP-7, BBP-19"); and its sub-issues, hung from their heading on
  the board's rails, or what blocks it and what it blocks, each with its
  glyph, id and title. Once one card shows, resting on
  another row swaps it at once. It stays while the pointer is on its row or
  on the card, or focus is on its row; Escape, wherever focus is, a press,
  or both pointer and focus leaving close it. Touch has no card: a tap opens
  the issue.
- **Sub-issues** hang under their parent's row on rails, a hairline from
  under the parent's glyph bending into each, in the parent's lane whatever
  their own status, each one line with everything a row has. They always
  show: the parent's count is not a fold. The parent, which never has an
  agent or a pull request, says how many are Done in its pill. The
  catch-up leads a parent's line with the count ("1/3 done"). A flagged
  sub-issue is also listed flat under Needs you, its parent's id ahead of
  its own ("BBP-1›BBP-3"). A lane's count is its rows: a parent counts
  once, its sub-issues by its own count. Folding a lane folds its parents
  with their sub-issues.

Pressing an issue, or Enter or Space on its row, opens it in its own tab in
the same side panel, beside the Board, titled with its id and title; pressing
an issue whose tab is open focuses that tab rather than adding a second one.
Close a tab with its close button. bb keeps the tabs across a reload. The tab
heads with the issue's status, id and kind, its pull request with CI and its
agent's thread, then its title and headline whole, which its row fades out at
its edge, and changes as the board does. Under them come what it is about;
its **Parent** and its **Sub-issues**; **Depends on** (a sub-issue's lists its
parent's open dependencies too, "through BBP-1") and **Blocks**, each issue there
with its status's glyph, id and title, and none when there are none; pressing
one opens that issue's tab the same way. The rest is the issue's own read,
which reads again only when something of that issue changes, never for
another issue's write.

**Done when** is a grid: a row per criterion, its number and words, then a
cell per round that has a verdict, green for passed, red for failed, amber for
couldn't check, lined up by the criterion's place. The head counts the rounds
and the latest's score ("3 rounds · latest 6 of 6", or "no verdict yet").
Pressing a cell, or Enter or Space on it, opens the row to that round's
evidence for the criterion, with the words that round judged; pressing it
again closes it. A research issue lists its **Questions** with no cells, and
nothing when it has none.

**Activity** lists every moment of the issue in the order it happened, with
**All**, **Rounds** and **Discussion** to choose what shows: Rounds only the
rounds, Discussion only the decisions and questions. The choice holds while
the tab is open. A **round** is one attempt: an agent's handoff and its
check, or a build parent's final check. Folded, it is one line: "Round 2",
what was handed off ("Final check on main" for a parent's) and its score: "✓ 6
of 6", "✗ 3 of 6", "Reviewing…", "Verifying…", "Couldn't verify",
"Replaced", "Not verified", or "Blocked" or "Gave up" for a handoff nothing
checks. The latest round is open; any other opens when you press it, and
stays as you left it while the tab is open, also when a new round arrives,
which opens as the new latest. Open, a round shows its steps on a rail: who
handed off and when, its summary, and its **Report** folded ("Report · 3 did
· 2 evidence"), with a research handoff's report as Markdown beside the
memory file it was saved to (such as `reports/BBP-2.md`), in its own box that
scrolls; then the reviewer: "Reviewer found 4 issues, 2 confirmed", each
finding with its severity, its place and its claim, and the verifier's
**Confirmed** or **Rejected** with why (a rejected claim is struck through),
or "No review" and why; then the verifier, with a link to its thread, its
score and when: the commit checked; the plugin's own read when that commit
wasn't checked out on a clean tree; what CI said when it failed, couldn't be
checked or is still to come; each failing or unverifiable criterion with its
evidence, and the passes folded ("4 passed"); and the verifier's own
findings. It warns when the check had to run on the agent's own model, but
names no provider or model. Last comes what became of it: "Sent back to a2
as fix round 1", "Not sent back: the regional manager decides", "Passed" and
the like, with when. A round's body is read only while it is open; one that
fails to read says so beside its steps, with Retry.

Between the rounds sit the **decisions**, full size: each question the
manager put to you about the issue, with its options and your answer and
when, the option you chose marked; one still open has a button per option
that answers it, as on the Board (one with no options is answered on the
Board, in your words); and each decision the manager recorded on it with
`issue_update`, with when (a later one stands over an earlier one, and every
agent started on the issue gets them in its first message). Everything else
is a quiet line: the manager filed the issue, started an agent or handed the
issue on from one, an agent's thread was archived or deleted, its pull request
opened, passed or failed CI or merged, an agent ended its turn with no
handoff (with its last answer), failed, or waits on you, and the issue was
unblocked. An agent named anywhere opens its thread while bb has it. The brief
is the agent's, so the tab doesn't show it.

A handoff places its issue until the agent's thread starts another turn: type
into an agent that handed off and its issue moves back to In progress. Rows
move between lanes as the threads change, without a reload. A thread status
this plugin doesn't know reads as idle.

## Memory files

Each regional manager has its own folder on the bb server:
`<bb data dir>/plugins/regional-manager/memory/<regional manager id>/`. The
server log names the parent folder when the plugin loads. It is made as the manager starts, with:

- `MEMORY.md`: the index of the files.
- `GOAL.md`: the goal, the message you sent from its page to start it.
- `NOTES.md`: the manager's plan, its reasoning and durable lessons, never
  what an issue already says.
- `RULES.md`: the user's standing rules for the manager, one per line.
- `CREW.md`: rules every agent will follow.

The work itself, who holds it, where it stands, what blocks it and what was
decided, lives in the issues. The manager tells you what you need to know or
decide in its replies; a turn that changed nothing for you, such as one woken
by a merge on work an agent is shipping, ends with `crew_end_turn` and a
one-line reason, and the manager writes nothing, not even a word. The board
keeps no digest. A manager started before this release had its plan and
preferences files renamed to `NOTES.md` and `RULES.md`, with their content,
and its digest file removed, as the plugin loaded; a file already there under
the new name, and any line you added to `MEMORY.md`, were left as they were.

The thread may add others, such as `notes/api.md`.

## Research reports

When a research issue's agent hands off done, the plugin saves its report to
`reports/<issue id>.md` in the manager's memory folder, as it stores the
handoff. The handoff keeps the report as the agent wrote it; the file is the
manager's copy. You can read and edit it under Memory in the manager's Board tab, and any agent
reads it with `crew_memory_read`. The plugin gives it to no agent: the
manager hands it on by naming the file in the brief of an agent that needs
it, and an agent started without that sees none of it. The plugin never
edits `MEMORY.md`.

A later report on the same issue (after the manager messaged its agent)
replaces `reports/<issue id>.md` only while that file is gone or still
exactly as the plugin last saved it. If you or the manager edited it, or
someone wrote it before the plugin saved anything there, it stays as it is,
and the new report goes beside it, as `reports/<issue id>-2.md`, then
`-3.md` and so on. `crew_catch_up` names the file each report went to and
says why when it isn't `reports/<issue id>.md`. Nothing anyone wrote is
replaced, and the handoff never fails over it.

## Issue links in chat

Experimental: this rests on bb's markup and slots that may change, so it is the
likeliest part to break with a bb update. A regional manager names an issue to
you as a link, `[BBP-24](/plugins/regional-manager/regional-managers/issue/<id>/BBP-24)`,
which `crew_catch_up`, `issue_create`, `issue_update` and `issue_read` hand it ready-made,
for each issue on the board, each ready one and each issue one relates to; the
id of the manager is in it because two managers can both have a BBP-24.

- **In a message**, from the manager or anyone, the link reads as the issue's
  status glyph and its id in mono, mid-sentence ("◕ BBP-24"), in the text's
  colour, underlined on hover. The glyph is the board's, live: it changes as
  the issue does, without the message changing. A bare `BBP-24`, or the link
  inside code, stays plain text.
- **Resting on it** for half a second, or focusing it, shows the Board's card
  for the issue, floating by the link so the message list never cuts it off.
  It stays while the pointer is on the link or the card; Escape closes it
  wherever focus is, and focus stays on, or goes back to, the link. A press
  puts it away; the card moves with its link, as the message scrolls or bb
  lays it out again, and goes once the link scrolls out of sight. When the card is
  too tall for the window and its body scrolls, Tab moves from the link into
  the card and Shift+Tab goes back.
- **Pressing it** opens the issue's tab beside the Board: in the manager's own
  thread, in that thread's side panel; from any other thread, the manager's
  thread opens in a split (or comes forward where it already shows) with the
  tab open. ⌘ or Ctrl asks for the split from the manager's thread too.
- **Elsewhere**: a link followed where the plugin's overlay doesn't run lands
  on the plugin's panel, which opens the manager's thread with the issue's
  tab, or says this bb server has no such manager (deleted, or the link is
  from another); Back from the thread goes to the panel's
  list, not to that page again. With the plugin disabled or removed, the
  link reads as a plain "BBP-24" and bb's plugin-unavailable page answers it;
  exported text and the CLI show the Markdown as written.

## Read and edit memory

**Memory** is the last section of a started regional manager's Board tab,
under its board. Its header folds it, as a lane's does, and it stays folded
through a reload. It shows its files (the core ones first, then the rest by
name) as one row of cards that scrolls sideways, each previewing the start of the file, rendered, with its
name under it and, for a file in a subfolder, its folder; a dot marks one
with unsaved changes. Pressing one shows it, rendered, with
**All files** to go back and **Edit**. Edit opens it in place, with **Save**
(or Ctrl/Cmd+S), which writes it and closes the editor, and **Cancel**, which
drops your changes. Each save wakes the regional manager with "The user
edited <file>". A file you aren't editing shows its latest text, including
the thread's writes as they land. Unsaved text stays in the browser, on the
file you had open, through a resize, a reload and another tab, until you save
it, cancel or take the newer version. A file deleted under unsaved text stays
shown ("Not in the folder"), with the text; saving makes it again. While you have unsaved changes, Esc
doesn't leave the tab. A regional manager not started yet has no memory.

Neither side can silently overwrite the other. Every write names the version
of the file it started from:

- **The thread's write is stale** (you saved since it read the file): nothing
  is written, and the thread gets your text to merge its change into.
- **Your save is stale** (the thread wrote, or the file changed on disk): your
  text stays, with the newer version beside it. Copy what you need into yours
  and press **Save mine over it**, or press **Use the newer version** to drop
  your changes.
- **A save fails** for another reason: the error shows above your text, which
  stays.

You can also edit the files in any editor on the server's disk; the thread
and Memory read the new text on their next read.

## What it needs

- **`gh`, signed in, on the machine running bb**, for pull requests and CI.
  Without it the board says "PR status unavailable: <why>" and verdicts that
  would wait for CI pass as "CI not checked".
- **bb's git plugin** (`bb--git`, built in), to read the commit, tree and
  branch an agent has checked out as it hands off, and the regional manager's
  own working tree as each of its turns ends. When it can't read an agent's,
  its done handoff can't be verified; when it can't read the manager's, no
  edit warning is recorded.
- **An environment provider**, such as the boat-sandbox plugin, only for
  agents you want off the regional manager's machine.

## Limits

- **Wakes are not instant.** An update never interrupts a running turn: the
  regional manager reads it when its turn ends. While it waits, bb's Queue
  above the composer lists the hidden message as "(empty message)".
  Reminders come due within about a minute; a pull request change shows
  within a minute while CI runs or a verdict waits for it, else within five,
  because pull requests are polled, never pushed.
- **Edits are detected, not prevented.** They are read after a turn ends, a
  committed one isn't seen, and nothing is blocked or reverted.
- Reminders take no cron expressions and nothing finer than a minute.
- The plugin never merges, approves or comments on a pull request.
- The plugin never runs an agent and its own verifier together, but you can:
  typing into an agent's thread while its verifier checks, or into a
  verifier's while its agent works, runs both in the same environment, and
  the plugin neither prevents nor flags that.
- A move takes committed work only, and through origin only what was pushed:
  the plugin never pushes, commits or copies for an agent, so a sandbox
  removed before its agent pushed takes its commits with it.
- A replaced agent's thread stays in the sidebar, stopped: someone typing
  into it wakes it in the environment the new agent works in, and the plugin
  neither prevents nor flags that. The next start on the issue stops it.
- **An unblocked wake can come late.** The plugin reads every issue again
  after anything an issue's status depends on changes. If bb's threads can't
  be read then, or the plugin reloads, the next minute's pass reads again and
  wakes the manager. If the manager's agents keep changing things while it
  reads, the wake waits until they pause: each later change and each minute's
  pass tries again. Either way it wakes the manager once for each close after
  the dependency was added. Meanwhile the catch-up's ready list and every
  blocked row are right, since they are derived on each read.
- **A plan write can ask to be tried again.** `issue_create` and `issue_update`
  judge a parent, a sub-issue or a dependency on every issue read as the write
  is made, reading again when something changed meanwhile. If the manager's
  agents keep changing things through a few reads, the call writes nothing and
  says to try again.
