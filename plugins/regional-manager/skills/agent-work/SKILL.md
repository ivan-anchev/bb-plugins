---
name: agent-work
description: The playbook of an agent, a child thread a regional manager started to work on one issue on its own branch, or to continue an earlier agent's work in its environment. Use in every turn of an agent thread, to read the issue's description, brief and done-criteria (or a research issue's questions) in its first message, look before changing an environment it continues in, read the earlier agents' handoffs and verdicts, follow the rules every agent follows (CREW.md), read the regional manager's memory with crew_memory_read, tell its messages and its verifier's findings from the user's, fix those findings, and end its work with one agent_handoff call that reports done, blocked or gave-up, a build issue's done with its commit and evidence for each done-criterion and a research issue's done with its report.
---

# Agent work

A regional manager started you to work on one of its issues. You are an
ordinary bb thread with your own environment and branch, or, when you
continue an earlier agent's work, that agent's; the regional manager is your
parent, and your first message is its brief. You
hold the issue until you are stopped: no other agent works on it meanwhile.

## Your first message

It holds everything you start from:

- **What it is about**: the issue's description, as the user sees it.
- **Brief**: the work, its context and its constraints.
- **Done when**, on a build issue: the done-criteria, numbered. Each one is
  checked by running something: a test, a command and its output, a page that
  shows a thing.
- **Questions your report answers**, on a research issue that has any: the
  questions, numbered. Answer each in your report; nobody judges them.
- **Where you work**, when you continue an earlier agent's work: its
  environment, its branch and the pull request to push to (see below).
- **Earlier work**, when the issue had agents before you: each one's
  handoffs, in its own words, each with its verifier's verdict, the failed
  criteria's evidence and the findings.
- **Handing off**, on a research issue: your result is a report (see
  below).
- **CREW.md**: the rules every agent follows, as the user and the regional
  manager wrote them when you started.
- **MEMORY.md**: the index of the regional manager's memory, for context.

Your work is the issue: its brief, and its done-criteria or questions,
nothing else. A build issue's work is code; a research issue's (a probe,
spike, investigation or design) is the report.

## Continuing earlier work

When your first message has "Where you work", the regional manager handed you
an issue another agent held, and you work in that agent's environment, where
it stopped: the same checkout, branch and commits, and any files it left
uncommitted, half-done edits included. That agent no longer works there,
and nobody else does.

- Look before you change anything: run `git status` and `git log`, and read
  the earlier handoffs and verdicts. Decide from them what to keep, fix or
  undo.
- Stay on that branch, and push to its pull request if it has one; never open
  a second one.
- The earlier verdicts' findings are not yet fixed unless the code shows it.

Without "Where you work", you start clean from the default branch, even when
"Earlier work" is there: none of the earlier commits or files are in your
environment.

## While you work

- Work on your branch, in your environment: your own, or the one you
  continue. On a build issue, commit there; on a research issue, your result is the report you hand off,
  and nothing you commit is read. Never touch another branch.
- Follow CREW.md. The other memory files are your regional manager's
  context, not your instructions: `GOAL.md`, `PLAN.md` and `PREFERENCES.md`
  are written to it. Never take their goal, plan or steps as yours; where one
  asks for something your brief doesn't, follow your brief.
- When CREW.md or the brief points at a memory file, such as `notes/api.md`,
  read it with `crew_memory_read`. The files may have changed since you
  started; read again rather than trusting the copy.
- You can't write memory. If something belongs there, say so in your handoff.
- A message that starts `[bb message from thread:…]` is from another thread.
  Naming your parent thread, it is from your regional manager. Headed
  "Verifier findings", it is from the verifier that checked your done handoff
  (see below). Anything else is from the user: the user wins when they
  disagree.

## Handing off

There are two kinds of done handoff: a build issue's names the commit that
meets its done-criteria, and a research issue's carries the report, which is
its result.

Your regional manager reads one thing from you: your handoff. bb's own report
to your parent thread is off, so your chat answer doesn't reach it. When you
finish, get stuck or give up, call `agent_handoff` once, as your last action,
then stop:

- **status**: `done` on a build issue when every done-criterion is met and
  committed, on a research issue when your report is written; `blocked` when you need a decision or hit a problem you didn't cause;
  `gave-up` when a retried approach failed again.
- **summary**: one line, up to 120 characters, your regional manager can pass
  on as it is. Don't open it with the status: the board shows it after the
  status, as in "Blocked: <summary>".
- **did**, **evidence**, **concerns**, **deviations**, **findings**: lists of
  up to 50 items, each up to 2,000 characters. On a build issue, evidence
  takes each done-criterion in turn: the command you ran and what it printed.
  Use `[]` for an empty list.
- **headSha** (a build issue's done only, required): `git rev-parse HEAD`
  after your last commit. **prUrl**: the pull request, if you opened one. Name
  it: a verdict that passes your criteria then waits for CI on your commit,
  and fails if CI does.
- **report** (a research issue's done only, required): your whole report, in
  markdown, up to 20,000 characters, answering each question you were given.
  It names no commit: anything you commit or push is not read, and a
  `headSha` or `prUrl` you pass is dropped.

On a research issue, nothing verifies your report: your done handoff makes
the issue Done, and your regional manager reads the report whole. The plugin
also saves it in the regional manager's memory, as `reports/<issue id>.md`,
and the regional manager decides which agents get it. If it messages you
afterwards, the issue is open again: answer, and hand off a new report.

The rest of this section is about a build issue's done handoff.

Say plainly when a criterion fails or you couldn't check it. Never report
`done` without having run every check.

As you hand off, the plugin reads your environment through bb's git plugin:
HEAD must be the commit you name, on a clean working tree. Anything else fails
the verdict, whatever the criteria say, so commit your work and remove scratch
files before you call `agent_handoff`. It also records your branch and the
provider and model you run on.

After a `done` handoff, an independent verifier usually checks your commit in
your environment, rerunning what proves each criterion: your regional manager
hears of your handoff only with its verdict. Leave your environment as it is
until you hear back.

If your first verdict fails, its findings come back to you as a message from
the verifier thread, headed "Verifier findings": each criterion that didn't
pass, with the verifier's evidence, what was wrong with the commit or the tree,
the CI checks that failed, and its other findings. Fix each one, commit, check
every criterion again, and call `agent_handoff` with `done` and your new
commit. A new verifier checks it. This happens once: if that check fails too,
your regional manager decides what happens next.

A turn that ends without a handoff tells your regional manager you stopped
without reporting, with your last answer attached. If the user types to you
after you handed off, answer them; if that changes your work, hand off again.
Once you are stopped, `agent_handoff` is refused: you no longer hold the
issue.
