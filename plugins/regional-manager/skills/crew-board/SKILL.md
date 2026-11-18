---
name: crew-board
description: Explain the Regional Manager plugin (bb-plugin-regional-manager). Its panel starts long-lived regional managers that keep memory in markdown files, plan the work as build or research issues, start an agent (a child thread) on each, set reminders and ask the user on a board; all of one manager's agents are its crew. An agent ends with a handoff; a build issue's done one is checked by a hidden verifier unless switched off, and a first failed verdict goes back to the agent; a research issue's carries a report saved to memory. PRs and CI are watched through gh. The Board lists issues by status, Needs you first. Use when the user asks how to start a regional manager or an agent, what an issue's kind, status or a verdict means, how verification or CI checks work, what an agent or verifier runs on, why PR status is unavailable, why an agent got findings or an issue returned to Todo, why the thread woke or the board warns of edits, how reminders or decisions work, where memory lives, or which thread has which tools.
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
3. bb's own new-thread composer opens, seeded with your first project (in the
   sidebar's order), a fresh worktree of its default branch on the machine
   running bb, and **auto** permissions. Change any picker as with any new
   thread.
4. Leave **Verify done handoffs** on (below the composer) to have every done
   handoff of build work checked before the thread hears of it, or turn it
   off.
5. Type the goal and submit. The new thread opens.

Your goal is its first message, exactly as you typed it. The plugin adds a
note after it that only the thread sees, not shown in your timeline: that
this thread is a regional manager, that it holds the goal whatever it is
about (this plugin's own repository included), that `bb status` shows no
roles, and that its first actions are to load its playbook and call
`crew_catch_up`. `crew_catch_up` opens with the same line every time.

The panel lists every regional manager bb still lists, under its project,
newest first, with bb's status glyph. A row opens its thread, its **Board**
button opens its board, and its **Memory** button opens its memory files. An
archived or deleted thread drops off the list.

## Tools

Each role gets its tools from the plugin's own database, so editing a
thread's metadata grants nothing. A call from any other thread is refused,
and no tool can turn verification on or off.

| Tool | Thread | What it does |
| --- | --- | --- |
| `crew_catch_up` | regional manager | Returns every update since its last catch-up, whole, then the board with what blocks each issue and the issues ready to start, the questions still waiting, its reminders, and its core memory files with their versions. |
| `crew_memory_read` | regional manager, agent, verifier | Reads one memory file, such as `PLAN.md` or `notes/api.md`, with its version. |
| `crew_memory_write` | regional manager | Writes one memory file whole, naming the version it read (null to create one); a stale write returns the current text instead. |
| `crew_remind` | regional manager | Sets a reminder (`note`, `at`, optional `every`) or cancels one (`cancel`). |
| `crew_ask_user` | regional manager | Puts a one-line question, with up to five options, on its board, optionally naming the issue it is about. |
| `issue_create` | regional manager | Files an issue: `kind`, `title`, `description`, and optionally `brief`, `doneCriteria`, `status` (todo or backlog), `verifier`, `parent` and `dependsOn`. |
| `issue_update` | regional manager | Changes an issue's kind (until an agent has started on it), title, description, brief, done-criteria, verifier, parent or dependencies, or rests, cancels or accepts it with `status`. |
| `issue_read` | regional manager | Returns one issue whole: status, what blocks it, plan, its parent and sub-issues, what it depends on and blocks, verifier, its agents and what they ran on, every handoff with its verdict, and its agent's latest answer. |
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
`i1`, `i2`… within its regional manager (an id is never reused). It has a
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
| Todo | No agent holds it, ready to start. A new issue rests here, and returns here when its agent ends before its work reached Verifying (on a research issue, Done). |
| In progress | An agent holds it: working, starting, idle without a handoff, fixing its verifier's findings, blocked, gave up, or its last turn failed. |
| Verifying | A build issue: its agent handed off done, and the verifier checks it, or every criterion passed and it waits for CI. |
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
  accepted unmerged flags the parent Needs you ("i3 isn't merged, so i1's
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
and could-not-run after that.

- **Passed**: the parent is Done ("✓ Final check passed"), closed by that
  check, and any issue waiting on it is unblocked, once.
- **Failed** or **couldn't run**: the parent is In progress and Needs you
  ("✗ Final check failed", "Couldn't run its final check"). Nothing goes back
  to any agent, and there is no fix round: the manager files the fix as a new
  sub-issue, which puts the parent In progress, and once that sub-issue is
  Done and merged a new final check starts by itself. A check never runs
  again without new merged work: a research or canceled sub-issue changes
  nothing on the default branch.
- **Verification off** when it comes due: no verifier starts. The parent is
  In review, "Unverified: verification was off", for the manager to accept.
  A check already running when verification is switched off still finishes.
- A verdict that returns after a sub-issue was filed under the parent, or the
  parent was closed, is kept in its record and places it no more; the
  manager's catch-up says where the parent stands now, from the same view the
  board shows.
- A build parent with no done-criteria when its check comes due Needs you
  ("i1 has no done-criteria for its final check"), and none starts until
  criteria are written. With no default branch on record in bb, none starts
  and the parent stays "Final check due". A research parent never has one.

The manager is woken with `i1 "Card vault" final check: failed` (or passed,
could not run, not run, verification is off), which quotes nothing;
`crew_catch_up` and `issue_read` print the verdict whole, with the default
branch and commit it judged and which model it ran on ("as named on i1", or
"a3's own model, as no other was available"). Each final check stays in the
parent's record. After its verdict, the verifier's thread and its worktree
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
would close a cycle is refused, naming the cycle (`i1 → i3 → i2 → i1`); a
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
Its issue keeps its place if the agent's work had reached Verifying, In
review or Done; otherwise the issue returns to Todo and the manager is woken
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
  under Needs you as "Couldn't verify", with the reason.
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
  `PREFERENCES.md` and name both on every issue and agent it covers. The
  board shows no model names; the manager's `crew_catch_up` and `issue_read`
  do.

## Proposing work

Tell the regional manager to propose work and wait for you, and it files the
issues in Backlog and describes them in one decision on its board (see
[Decisions](#decisions)), starting no agent. Its rules tell it to do this
whenever you asked it to propose and wait, or `PREFERENCES.md` says so. Your
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
  before its work reached Verifying.
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
- **The user saved a memory file** in the Memory editor. The thread's own
  writes don't count.
- **The user turned verification on or off.**
- **One of the thread's reminders came due** (see [Reminders](#reminders)).
- **You answered one of its decisions** (see [Decisions](#decisions)).
- **Its own turn ended with changed files in its working tree** (see
  [Edits it makes itself](#edits-it-makes-itself)), or with the tree clean
  again after that.

A build issue's `done` handoff is announced only together with its verdict
(see [Verification](#verification)); everything else at once, a research
issue's done handoff included, as `- i2 "Pick a card vault" (a2) handed off:
done`. `crew_catch_up` then prints its report whole with the file it was
saved to.

Each one wakes the regional manager with one short message: the plugin's
name in brackets, how many updates there are, and one line each, naming the
issue and its agent, such as
`- i1 "Add retries" (a1) handed off: done, failed verification`,
`- i2 "Dead letters" (a2) handed off: blocked`,
`- i1 "Add retries" (a1) PR #41: CI passed`,
`- i3 "Metrics" (a3) returned to Todo: its agent was stopped`,
`- i4 "Card vault schema" is unblocked: i2 done`,
`- The user edited PLAN.md`, `- Your reminder r1: check on i1`,
`- The user answered your question d1: Target main or release/2?` or
`- Your own environment has 2 files changed after your turn: hand the change to an agent`.
The tree being clean again, like a fix round sent back, wakes nobody: it is
listed in the next message and catch-up.

The message reaches the thread as if you typed it, so it holds only facts the
plugin derived and what the thread wrote itself (its issues' titles, its
reminders' notes and the questions it asked you): never an agent's summary,
answer, error or question, a verifier's evidence, nor your answer to a
decision. Those are in `crew_catch_up`, which returns every update since the
last catch-up, whole, once.

The message never interrupts a running turn: it waits in the thread's queue
until the turn ends. While one waits, the next updates wait for it to be
sent, then get a message of their own. Once `crew_catch_up` has returned
every update, a message still waiting in the queue is taken back, so the
thread isn't woken for updates it has read. A send that fails is retried by a
once-a-minute tick, which also forgets a waiting message bb no longer holds.
If bb gives up sending a waiting message (its retries spent), the tick takes
it out of the queue and sends what it announced again.

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
  "on claude-code opus, as named on i1".
- **No verdict**: a verifier that ends a turn without one is reminded once,
  when its agent is idle;
  a second time, or a verifier bb wouldn't start, whose thread was archived,
  or whose environment bb removed, reads "Couldn't verify" with the reason.
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

Turn verification off or on with the switch at the top of the board (or on
the New page when starting). It applies to handoffs made after it: turning it
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
  is listed, as in `- i1 "Add retries" (a1) handed off: done, failed
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
  on i1") and `at`, when it first comes due: `"2m"`, `"in 2h"` or `"3d"` from
  now (whole minutes, hours or days), or an ISO 8601 time with its offset,
  such as `"2026-11-16T17:00+02:00"` (the thread can't know the server's time
  zone, so a time without one is refused). Add `every`, such as `"30m"`,
  `"2h"` or `"every 1d"`, to repeat it. A time the plugin can't read, a date
  that doesn't exist (such as `2027-02-29`), or one in the past, is refused
  with the forms it accepts, and nothing is set. It returns the reminder's
  id: `r1`, `r2`… An id is never reused.
- **When it comes due**, the once-a-minute tick wakes the thread with its
  note, as in `- Your reminder r1: check on i1`, within about a minute. A
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
also waits under Needs you until you answer. Your answer moves the decision to
**Done**, with the answer and when you gave it, and wakes the thread; its
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
  say so in its digest. It never stashes, reverts, checks out or deletes
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

The **Board** tab in a regional manager's side panel, and the **Board**
page from its row in the panel, show the same board, live:

- **Verify done handoffs**: the switch for this regional manager.
- **Files changed in its own environment**: a warning with how many, and
  when its turn ended, while the latest read of its working tree found
  changed files (see [Edits it makes itself](#edits-it-makes-itself)).
- **PR status unavailable: <why>**, only while the latest read of a pull
  request failed.
- **Digest**: `DIGEST.md`, the regional manager's latest summary for you,
  and when it last changed.
- **Lanes**: Needs you, then In review, Verifying, In progress, Todo,
  Backlog, Done and Canceled, each under a bar with its glyph, how many it
  holds and a chevron. Pressing the bar folds or unfolds the lane; Backlog,
  Done and Canceled start folded, and an empty lane isn't shown. Needs you
  holds the open decisions put to you, then the issues flagged Needs you,
  each with its own status's glyph; answered decisions sit under Done.
- **Issues**, each row with its status's glyph, its id, kind and title, a
  one-line headline that says why it is where it is (such as "Working",
  "Verifying: <summary>", "✓ Verified: <summary>" or "Blocked: <summary>"),
  its agent, which opens the agent's thread, and once it has one, its pull
  request: its number in its state's colour, with a dot for its CI, which
  opens it on GitHub. A research issue's row reads "Research" and never has
  a pull request. An issue a dependency blocks starts its headline line with
  "blocked by i6" (two named, the rest counted: "blocked by i6, i7 +2") and
  stays in its own status's lane: blocked is not a lane, and doesn't put it
  under Needs you. That differs from an agent's "Blocked: <summary>"
  headline, which is the agent asking you for something, under Needs you.
- **Sub-issues** sit indented one level under their parent's row, in the
  parent's lane whatever their own status, each with its own glyph and
  everything a row has. The parent, which never has an agent or a pull
  request, shows how many of its sub-issues are Done at the right of its
  first line ("1/3"), and its headline says only what that count doesn't:
  why it is flagged, where its final check stands ("Final check due", "Final
  check running", "✓ Final check passed", "✗ Final check failed"), or
  nothing. With nothing under its title the row is that one line; a headline
  coming or going adds or takes its second line and moves nothing else. The
  catch-up, with no such cell, leads a parent's line with the count ("1/3
  done"). A flagged
  sub-issue is also listed flat under Needs you, its parent's id ahead of its
  own ("i1›i3"). A lane's count is its rows: a parent counts once, its
  sub-issues by its own count. Folding a lane folds its parents with their
  sub-issues.

Pressing an issue opens it in place: its row grows to show its title and
headline whole, which a closed row fades out at its edge, and under it come
what it is about; its **Parent**, only on a flagged sub-issue's row under
Needs you, away from its parent (rows nest sub-issues already, so a detail
lists none); **Depends on** (a sub-issue's lists its parent's open
dependencies too, "through i1") and **Blocks**, each issue there with its status's glyph, id and title, and none
when there are none; pressing one goes
to that issue on the board, unfolding its lane, opening its row, moving
focus to it and scrolling it to the top (as near as the board's end
allows), its detail under it; **Done when** with its criteria (a research issue's
**Questions**, and nothing when it has none), and its **Record**: each
agent that held it, how it ended, and each handoff it made, the latest one
open. A research issue's done handoff shows its **Report** first, as the
Markdown it is, beside the memory file it was saved to (such as
`reports/i2.md`): a long report scrolls in its own box, and the file holds
it whole in the Memory editor. Nothing verifies it, so it has no verdict.
A build issue's handoff shows the verdict on it first: how many criteria passed, a link to the verifier thread,
and the commit checked; the plugin's own read when that commit wasn't checked
out on a clean tree; what CI said about that commit when it failed, couldn't
be checked or is still to come; then each criterion with Pass, Fail or
Unverifiable. A failed or unverifiable criterion shows its evidence; a passed
one folds it away until you open it. The verifier's findings follow. It warns
when the check had to run on the agent's own model, but names no provider or
model. A verdict still to come says so, with the verifier's thread while it
checks, and one that couldn't be had says why. Then what the agent reported:
what it did, its evidence, concerns, deviations and findings. A build
parent's detail lists its **Final checks** above its record, oldest first,
the latest open, each as "Passed", "Failed", "Running", "Couldn't run",
"Replaced" or "Not run" on its default branch, with its time; opened, it is
read as a handoff's verdict is, its commit as "On main at 4be0a17" and a
dirty worktree as "Not a clean tree". Pressing the
issue again closes it. The brief is the agent's, so the board doesn't show it.

A handoff places its issue until the agent's thread starts another turn: type
into an agent that handed off and its issue moves back to In progress. Rows
move between lanes as the threads change, without a reload. A thread status
this plugin doesn't know reads as idle.

## Memory files

Each regional manager has its own folder on the bb server:
`<bb data dir>/plugins/regional-manager/memory/<regional manager id>/`. The
server log names the parent folder when the plugin loads. It starts with:

- `MEMORY.md`: the index of the files.
- `GOAL.md`: the goal typed in the composer.
- `PLAN.md`: the plan.
- `PREFERENCES.md`: the user's standing preferences, one per line.
- `CREW.md`: rules every agent will follow.
- `DIGEST.md`: the latest summary for the user.

The thread may add others, such as `notes/api.md`.

## Research reports

When a research issue's agent hands off done, the plugin saves its report to
`reports/<issue id>.md` in the manager's memory folder, as it stores the
handoff. The handoff keeps the report as the agent wrote it; the file is the
manager's copy. You can read and edit it in the Memory editor, and any agent
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

## Read and edit memory

Press **Memory** on a row in the panel. Each save wakes the regional
manager with "The user edited <file>". The page shows the folder's path on
the bb server, the files (the core ones first, then the rest by name), and an
editor for the file you pick. A file you haven't touched shows its latest
text, including the thread's writes as they land. A dot marks a file with
unsaved changes; switching files keeps them, and so do a resize, a reload and
another tab: unsaved text stays in the browser, on the file you had picked,
until you save it or take the newer version. **Save** (or Ctrl/Cmd+S) writes
the file. While you have unsaved changes, Esc doesn't leave the page.

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
and the Memory page read the new text on their next read.

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
  regional manager reads it when its turn ends. Reminders come due within
  about a minute; a pull request change shows within a minute while CI runs or
  a verdict waits for it, else within five, because pull requests are polled,
  never pushed.
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
