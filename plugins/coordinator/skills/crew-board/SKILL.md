---
name: crew-board
description: Explain the coordinating-thread plugin (bb-plugin-coordinator). Its rail panel starts long-lived coordinating threads. Each keeps its memory in markdown files, sets itself reminders, asks the user for decisions on its board, and starts crew threads (or drafts) from a brief and done-criteria. A crew ends with a handoff; a done one is checked by a hidden verifier unless switched off, and a first failed verdict goes back to the crew. PRs and CI are watched through gh; a pass waits for CI. The Board shows the digest, decisions, crews grouped from Needs you to Done, and a warning when the thread edits files itself. Use when the user asks how to start a coordinating thread or crew, what the board, a row or verdict means, how verification or CI checks work, why PR status is unavailable, why a crew got findings, how to replace a crew, what an update is, why the thread woke or the board warns of edits, how reminders or decisions work, where memory lives, which thread has which tools, or how drafts work.
---

# Coordinating threads

This plugin turns one ordinary bb thread into a long-lived **coordinating
thread**: it holds a goal, keeps its memory in files, plans the work, and
hands each piece to a **crew thread**. It has no CLI commands and no plugin
settings. Its one setting belongs to each coordinating thread: the **Verify
done handoffs** switch (see [Verification](#verification)).

## Start one

1. Open the plugin's panel in bb's navigation rail.
2. Press **New** in its title bar.
3. bb's own new-thread composer opens, seeded with your first project (in the
   sidebar's order), a fresh worktree of its default branch on the machine
   running bb, and **auto** permissions. Change any picker as with any new
   thread.
4. Leave **Verify done handoffs** on (below the composer) to have every done
   handoff checked before the thread hears of it, or turn it off (see
   [Verification](#verification)).
5. Type the goal and submit. The new thread opens.

The panel lists every coordinating thread bb still lists, under its project,
newest first, with bb's status glyph. A row opens its thread, its **Board**
button opens its board, and its **Memory** button opens its memory files. An
archived or deleted thread drops off the list.

## What the thread gets

From its first turn the thread has:

- its rules: call `crew_catch_up` first at the start of every turn, never edit
  project files, build or commit itself, and delegate with checkable
  done-criteria;
- the `coordinating` skill, its playbook;
- nine tools:
  - `crew_catch_up` returns every update since its last catch-up in full
    (below), the board, then its core memory files in full,
    each with its version, in a fixed order, up to 40,000 characters; files
    past that are named so it can read them alone, and so is every other
    memory file.
  - `crew_memory_read` reads one memory file by name, such as `PLAN.md` or
    `notes/api.md`, with its version.
  - `crew_memory_write` writes one memory file whole, naming the version it
    read (or none, to create a file). If the file changed since, nothing is
    written and it gets the current text to merge into and write again.
  - `crew_start`, `crew_message`, `crew_read` and `crew_close` start and
    manage its crews (below). `crew_start` with `supersedes` replaces one
    (see [Replacing a crew](#replacing-a-crew)).
  - `crew_remind` sets or cancels one of its reminders (see
    [Reminders](#reminders)).
  - `crew_ask_user` puts a decision to you on its board (see
    [Decisions](#decisions)).

  A name that leaves the memory folder or doesn't end in `.md` is rejected.
  Its rules tell it to keep its plan in `PLAN.md`, each standing preference
  you give it in `PREFERENCES.md`, and a digest in `DIGEST.md`.

A crew thread is offered only `crew_memory_read` and `crew_handoff`, and a
verifier thread only `crew_memory_read` and `crew_verdict`. Any other thread
is offered none of these tools, and a call from one is refused. No tool can
turn verification on or off. A thread's role comes
from the plugin's own database, so editing a thread's metadata grants nothing.

## Tools

Every tool, by the thread that gets it. A call from any other thread is
refused.

| Tool | Thread | What it does |
| --- | --- | --- |
| `crew_catch_up` | coordinating | Returns every update since its last catch-up, whole, then the board, then its core memory files with their versions. |
| `crew_memory_read` | coordinating, crew, verifier | Reads one memory file, such as `PLAN.md` or `notes/api.md`, with its version. |
| `crew_memory_write` | coordinating | Writes one memory file whole, naming the version it read (null to create one); a stale write returns the current text instead. |
| `crew_start` | coordinating | Starts a crew from a title, brief, 1 to 12 done-criteria and a placement; `draft: true` saves a draft, `supersedes` replaces a crew. |
| `crew_message` | coordinating | Messages one crew, marked as from the coordinating thread. |
| `crew_read` | coordinating | Returns one crew's state, branch, brief, criteria, latest handoff and latest answer. |
| `crew_close` | coordinating | Resolves, stops or archives one crew. |
| `crew_remind` | coordinating | Sets a reminder (`note`, `at`, optional `every`) or cancels one (`cancel`). |
| `crew_ask_user` | coordinating | Puts a one-line question, with up to five options, on its board. |
| `crew_handoff` | crew | Ends the crew's work: done (with its commit), blocked or gave up, with a summary and its lists. |
| `crew_verdict` | verifier | Returns each criterion's result and evidence, and findings, for the handoff it checks. |

## Crews

A crew is an ordinary child thread of the coordinating thread, which starts
it with `crew_start`:

- **Where it runs**: a fresh worktree of the project's default branch on the
  coordinating thread's machine, on its own branch; or, when the coordinating
  thread names one, an environment provider such as `boat-sandbox` (see
  [Crews in a sandbox](#crews-in-a-sandbox)). It runs with auto permissions.
- **What it runs on**: the provider and model picked in its draft's editor;
  otherwise its coordinating thread's provider, model, reasoning level and
  service tier as they are when it starts. Never bb's default: if bb has no
  model on record for the coordinating thread, the crew stays a draft and says
  why.
- **Its first message**: the brief, the done-criteria (1 to 12, required), and `CREW.md` and `MEMORY.md`
  as they were at that moment. Put rules every crew follows in `CREW.md`.
- **Its id**: `c1`, `c2`… within its coordinating thread. Its thread is
  titled with the crew's title and sits under the coordinating thread in
  bb's sidebar.
- **What it gets**: its rules, the `crew-work` skill, `crew_memory_read` and
  `crew_handoff`. It can't write memory or start crews.

The coordinating thread messages a crew with `crew_message` (it arrives
marked as from the coordinating thread, not from you), reads it with
`crew_read`, and closes it with `crew_close`: **resolve** accepts its work,
**stop** stops its turn (recorded once bb confirms the thread stopped), and
**archive** archives its thread. You can open any crew's thread and type into
it like any thread.

Archiving or deleting the coordinating thread archives or deletes its crews
with it.

### Crews in a sandbox

`crew_start` with `placement: {"kind": "provider", "environmentProviderId":
"boat-sandbox"}` starts the crew on a new machine from that environment
provider, here a boat sandbox with the project cloned and a new branch made
from its default branch, which bb names and records, so the crew works on its
own branch from the start, as a worktree crew does.
`machineInputs` sets that machine's inputs, such as `{"preset": "small"}` for a
small boat sandbox; `bb environment providers --json` lists each provider's.
Without them the provider's defaults apply. The plugin checks the provider
with bb first: one bb doesn't have, one that needs inputs the plugin can't
give, or `machineInputs` for one that makes no machine, is refused and nothing
is saved, and so is one that needs a new branch when bb records no default
branch for the project.

- The crew's tools run on the bb server, so `crew_memory_read` and
  `crew_handoff` work from the sandbox as from any machine.
- The plugin never reads the sandbox just to learn the crew's branch, since
  a read could wake it or keep it from idling: the branch is the one bb made,
  until the crew hands off on another (see
  [Pull requests and CI](#pull-requests-and-ci)).
- Its verifier runs in the same sandbox, on the crew's own checkout.
- A sandbox removed before its verifier returns a verdict (by hand, or by
  the sandbox provider's idle sweep) leaves the crew under Needs you as
  "Couldn't verify", with the reason.

## Drafts

Tell the coordinating thread to propose crews and wait for you, and it calls
`crew_start` with `draft: true`: the crew is saved, numbered and shown on the
board, and no thread starts. Its rules tell it to do this whenever you asked
it to propose and wait, or `PREFERENCES.md` says so.

A draft sits under **Needs you**, headed "Draft: <title>", with the first line
of its brief and two buttons:

- **Edit** opens the draft under its row: bb's own new-thread composer holding
  the brief, with its model, environment and permission pickers, and the
  done-criteria as a list you can change, add to (up to 12) or remove from.
  Each criterion's field grows to show all of it. In a criterion, Enter starts
  the next one (the text after the caret moves into it), Shift+Enter breaks
  the line, and Backspace at its start joins it to the one above, or removes
  it when it is empty.
  Until you pick one, the model picker shows the composer's own default, not
  the coordinating thread's model, and saving stores what it shows. The environment
  is a fresh worktree on the coordinating thread's machine (or the provider it
  named). The composer's own send button stores it all; **Cancel** drops your
  changes, and the next **Edit** starts from what is stored. While it is open,
  Esc doesn't leave the page.
  The project stays the coordinating thread's, and a brief is text only.
- **An open edit is kept** in the browser (localStorage) until you save or
  cancel it: a reload, a restart or bb redrawing the panel brings back the
  open editor, your brief and your done-criteria, and every tab of that
  browser shows the same edit. A model or environment you picked but haven't
  saved goes back to the draft's: bb's composer keeps those picks only while
  it is on screen. If the
  draft is saved somewhere else meanwhile (another browser or device), the
  editor says which parts changed and shows the saved version in full; saving
  puts yours over it, and **Drop mine and edit the saved version** takes it
  instead. If the crew starts or is closed elsewhere first, its row says your
  edit wasn't used until you dismiss it.
- **Start** spawns the crew from what is stored, exactly as `crew_start` does
  without `draft`: CREW.md and MEMORY.md are copied as they are at that
  moment. The row moves to its new group and keeps keyboard focus. A second
  click while it starts joins the first, so one thread starts. A crew that
  started or is closed can't be started or edited again.

A crew whose spawn bb never confirmed is a draft too, so **Start** tries it
again. `crew_catch_up` lists every draft as waiting for you, and `crew_close`
closes one like any crew. Starting a draft doesn't wake the coordinating
thread; it sees the crew on its next catch-up.

## Handoffs and updates

bb's own report to the parent is off for crews. Instead, a crew ends its work
with `crew_handoff`, and the plugin stores everything it sees:

- **A handoff**: `done` (with the commit, required, and a pull request link
  if there is one), `blocked` or `gave-up`; a one-line summary (up to 120
  characters); and what it did, its evidence, concerns, deviations and
  findings (up to 50 items each, each up to 2,000 characters). It is stored
  whole. Only a crew thread can hand off; a call from any other thread is
  refused.
- **A crew failed**, with bb's error.
- **A crew waits on the user**: a question or an approval in its thread.
- **A crew ended a turn without a handoff**, with its last answer.
- **The user saved a memory file** in the Memory editor. The thread's own
  writes don't count.
- **A crew's pull request changed** (see [Pull requests and CI](#pull-requests-and-ci)):
  it opened, reopened, merged or closed, its CI passed or failed, or a review
  approved it or asked for changes. A new CI run starting is not an update.
- **One of the thread's reminders came due** (see [Reminders](#reminders)).
- **You answered one of its decisions** (see [Decisions](#decisions)).
- **Its own turn ended with changed files in its working tree** (see
  [Edits it makes itself](#edits-it-makes-itself)), or with the tree clean
  again after that.

A `done` handoff is announced only together with its verdict (see
[Verification](#verification)); a blocked or gave-up one, and everything
else, at once. The user turning verification on or off is an update too.

Each one wakes the coordinating thread with one short message: the plugin's
name in brackets, how many updates there are, and one line each, such as
`- c1 "Add retries" handed off: done, failed verification`,
`- c2 "Dead letters" handed off: blocked`, `- c1 "Add retries" PR #41: CI
passed`, `- The user edited PLAN.md`, `- Your reminder r1: check on c1`,
`- The user answered your question d1: Target main or release/2?` or
`- Your own environment has 2 files changed after your turn: hand the change to a crew`.
The tree being clean again, like a fix round sent back, wakes nobody: it is
listed in the next message and catch-up.
The message reaches the thread as if you typed it, so it holds only facts the
plugin derived and what the thread wrote itself (the titles it gave its crews,
the notes of its reminders and the questions it asked you): never a crew's
summary, answer, error or question, a verifier's evidence, nor your answer to
a decision. Those are in
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

## Verification

Every `done` handoff claims an exact commit. While a coordinating thread's
**Verify done handoffs** switch is on (the default), the plugin itself starts
a **verifier** for each one:

- **Where**: a hidden thread, a child of the crew's thread, in the crew's own
  environment. Archiving the coordinating thread takes it along.
- **On what model**: the coordinating thread's, if the crew runs on another;
  else the default model of another provider bb can run there; else another
  model of the crew's provider; else the crew's own, which the verdict then
  says. The provider and model are always chosen by the plugin, never left to
  bb's default.
- **The commit and the tree**: the plugin checks them itself, not the
  verifier. As the crew hands off, it reads the crew's environment through
  bb's git plugin on its machine: HEAD must be the claimed commit, on a clean
  working tree. The verifier is given that read, labelled as the plugin's,
  and is told not to judge them again: a provider's per-command sandbox can
  show files the crew's tree doesn't have, and failed clean work. When the
  read is wrong (another commit, or changed files), the verdict fails with
  it as evidence, shown above the criteria, and goes back to the crew like
  any first failure. When bb's git plugin can't read it (the plugin off, the
  machine unreachable, not a git repository), no verifier starts: the crew
  reads "Couldn't verify" under Needs you with the reason, and no fix round
  is spent.
- **What it does**: runs what proves or disproves each done-criterion and
  quotes the output. It never edits, commits or pushes, and it gets none of
  the crew's own report. It ends with `crew_verdict`: each criterion `pass`,
  `fail` or `unverifiable`, with its evidence, and any findings. A verdict
  that skips, repeats or invents a criterion is refused.
- **Outcome**: derived, never stored. Verified only when the commit and the
  tree were as claimed, every criterion passed, and CI didn't fail on the commit when the crew has a pull request
  (see [Pull requests and CI](#pull-requests-and-ci)); an unverifiable
  criterion is not a pass.
- **No verdict**: a verifier that ends a turn without one is reminded once;
  a second time, or a verifier bb wouldn't start, whose thread was archived,
  or whose environment bb removed (its sandbox was removed or reaped), reads
  "Couldn't verify" with the reason.
- **A newer done handoff** from the same crew stops the older verifier, and
  only the newer handoff is checked and announced.
- **A verifier that never started** (the plugin reloaded at that moment) is
  started by the once-a-minute tick.

### One automatic fix round

A crew's first failed verdict (any criterion failed or unverifiable, or CI
failed on its commit) doesn't wait for the coordinating thread:

- The plugin sends the crew's thread one message, **from the verifier
  thread**: bb shows it as another thread's message, so the crew never takes
  it for yours. It is headed "Verifier findings" and holds each criterion that
  didn't pass, with the verifier's evidence, the checks that failed when CI
  did, and its other findings.
- The crew starts working on it at once (or after its running turn), so its
  row moves to Working. It commits, hands off again, and a new verifier checks
  the new commit: Verifying, then Ready for review or Needs you.
- Until bb has taken the findings, the row stays Verifying.
- The coordinating thread has nothing to do, so this alone doesn't wake it.
  It is listed, as in `- c1 "Add retries" handed off: done, failed
  verification, findings sent back to it (fix round 1)`, in its next doorbell
  (whatever rings it next) and its next catch-up.
- A crew gets **one** such round, counted on the crew before the findings are
  sent, and kept across reloads. Its next failed verdict sends nothing
  back: the row waits under Needs you as "✗ Failed verification after its fix
  round: <summary>", and the coordinating thread decides: message the crew,
  ask you, or replace it.
- A crash or reload while the findings are sent, or a send that fails in a
  way that doesn't prove bb refused them (a timeout, a dropped connection, a
  server error), leaves no record in bb that shows whether they arrived. They
  are never sent again on a guess: the round stays spent, the row waits under
  Needs you as "✗ Failed verification, its findings may or may not have
  reached it: <summary>", and the coordinating thread is woken to read the
  crew's thread and decide.
- Nothing is sent back for a handoff that is no longer the crew's current one
  (the crew was messaged or handed off again before its verdict), or for a
  closed crew. When bb refuses the message before taking it (the crew's thread
  is archived, deleted or can't take a message), its round is given back, and
  the coordinating thread's catch-up says bb refused the findings, with bb's
  answer. Either way the verdict goes to the coordinating thread.

### Replacing a crew

`crew_start` with `supersedes: "c3"` stops c3 and closes it as stopped (it
shows under Done), then starts a fresh crew from c3's title, brief,
done-criteria, placement and model. Its brief ends with c3's latest verdict
under "Previous attempt's verifier findings": each criterion that didn't pass,
with its evidence, and the findings. The coordinating thread may give a new
title, brief, done-criteria or placement; the findings are added either way.
Nothing starts while c3's thread is still stopping, and a draft can't be
replaced.

Turn verification off or on with the switch at the top of the board (or on
the New page when starting). It applies to handoffs made after it: turning it
back on doesn't check earlier ones. Each change tells the coordinating
thread. With it off, a done handoff waits under Ready for review as
"Unverified: <summary>".

## Pull requests and CI

bb tells plugins nothing about pull requests, so the plugin reads them itself,
with `gh` on the machine running bb, on the same once-a-minute tick:

- **What**: each open, started crew's newest pull request from its branch:
  the one it had checked out at its latest handoff, read once through bb's
  git plugin as it hands off, while it is awake anyway; else the one bb made
  its environment on. Nothing else reads a crew's environment for its branch,
  so a crew in a sandbox is never woken for it. For each, its number, state (open, draft, merged, closed), review (approved, changes
  requested) and its CI on its head commit, as GitHub's merge box rolls the
  checks up (passing, failing with the failed checks' names, running, or no
  checks). A check state GitHub adds later counts as running, never as a pass.
- **How often**: one `gh api graphql` call per GitHub repository for all its
  crews. A repository is read every tick while any of its crews' CI is running
  or a verdict waits for CI, else every five minutes. A closed crew, or one
  whose thread is gone, is never read. A crew whose pull request was read
  merged or closed isn't read again until it hands off again. Only projects
  whose git remote is on github.com are read.
- **A verdict waits for CI**: a done handoff that passed every criterion, when
  it names a pull request or one is known for the crew, waits under Verifying
  as "Waiting for CI on #41: <summary>" (or "Waiting for CI" before the
  pull request is seen) until CI finishes on the very commit the handoff
  claims; CI on another commit says nothing about it. CI passing makes it
  verified, and it moves to Landing within about a minute. CI failing makes it
  a failure, which goes back to the crew as above, naming the failed checks.
  Only then does the coordinating thread hear of it. A handoff with no pull
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

Rather than wait or poll, a coordinating thread sets itself a reminder with
`crew_remind`:

- **Set one** with a `note` (one line, up to 500 characters, such as "check
  on c1") and `at`, when it first comes due: `"2m"`, `"in 2h"` or `"3d"` from
  now (whole minutes, hours or days), or an ISO 8601 time with its offset,
  such as `"2026-11-16T17:00+02:00"` (the thread can't know the server's time
  zone, so a time without one is refused). Add `every`, such as `"30m"`,
  `"2h"` or `"every 1d"`, to repeat it. A time the plugin can't read, a date
  that doesn't exist (such as `2027-02-29`), or one in the past, is refused
  with the forms it accepts, and nothing is set. It
  returns the reminder's id: `r1`, `r2`… An id is never reused.
- **When it comes due**, the once-a-minute tick wakes the thread with its
  note, as in `- Your reminder r1: check on c1`, within about a minute. A
  one-off is then gone. A repeating one moves to its next time after now, so
  one missed several times while bb was down wakes the thread once, and keeps
  its schedule.
- **See them**: `crew_catch_up` lists every reminder with its id, when it is
  next due and how often it repeats.
- **Cancel one** with `crew_remind` and `cancel: "r1"`. A thread can cancel
  only its own.
- **An archived coordinating thread** is never woken: its due reminders wait,
  and wake it once bb lists it again, unarchived. A **deleted** coordinating
  thread's reminders are deleted.

## Decisions

When only you can decide something, a coordinating thread asks with
`crew_ask_user`: a one-line question (up to 500 characters) and up to five
options (each one line, up to 80 characters, no two alike), or none. It
returns at once and the thread keeps working: the question never waits as a
form in its thread, where it would hold every update meant to wake it. It
gets an id: `d1`, `d2`… An id is never reused.

The decision shows on the board under **Needs you**, above the crews there,
with a button for each option and a field to answer in your own words: Enter
sends it and Shift+Enter breaks the line, and Esc doesn't leave the page while
it has text. A send that fails keeps your text, with the error under it. Text
you haven't sent stays in the browser, through a resize or a reload, until you
send it or the decision is answered elsewhere. Your
answer moves the decision to **Done**, with the answer and when you gave it,
and wakes the thread; its `crew_catch_up` returns your answer, as the option
you chose or in your own words, with its question. A decision is answered
once: a second answer, as from another window, is refused.

The panel's entry in the navigation rail counts everything under **Needs
you** on every board the panel lists: open decisions and crews alike, the same
rows each board shows there. Its name says which, as "3 need you: 1 decision,
2 crews". It drops as you answer a decision or a crew leaves Needs you.

A crew's own question or approval stays in the crew's thread, for you to
answer there.

## Edits it makes itself

A coordinating thread's rules say it never edits project files, builds or
commits. bb can't enforce that (there is no read-only mode, and a plugin can't
take a provider's file tools away), so the plugin **detects** it instead:

- **When**: each time one of the coordinating thread's turns ends, the
  plugin reads its own environment's working tree through bb's git plugin
  (`bb--git` `status`). Crews' and verifiers' turns aren't read.
- **Changed files** (any modified, added, deleted or untracked file) put a
  warning at the top of its board, under the switch: how many files changed
  in its own environment, when its turn ended, and that it was told to hand
  the change to a crew. The thread is woken
  with `- Your own environment has 2 files changed after your turn: hand the
  change to a crew`, and its `crew_catch_up` tells it to describe the change
  in a crew brief saved as a draft (always: it never starts that crew
  itself), so a crew you start redoes it on its own branch, then ask you on its board whether to discard the changes in
  its environment; or, if you made the changes, to leave them and say so in
  its digest. It never stashes, reverts, checks out or deletes anything
  there, not even its own changes, since you may have edited the same
  files: discarding them is yours to do.
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

The **Board** tab in a coordinating thread's side panel, and the **Board**
page from its row in the panel, show the same board:

- **Verify done handoffs**: the switch for this coordinating thread.
- **Files changed in its own environment**: a warning with how many, and
  when its turn ended, while the latest read of its working tree found
  changed files (see [Edits it makes itself](#edits-it-makes-itself)).
- **PR status unavailable: <why>**, only while the latest read of a crew's
  pull request failed.
- **Digest**: `DIGEST.md`, the coordinating thread's latest summary for you,
  and when it last changed.
- **Decisions** the thread put to you (see [Decisions](#decisions)): open
  under Needs you, answered under Done, each above the crews in its group.
- **Crews**, each with its id, title, a one-line headline and its branch (the
  one it had checked out at its latest handoff, else the one bb made its
  environment on),
  then, once it has one, its pull request: its number, which opens it on
  GitHub, its state, its CI and its review. Grouped:
  - **Needs you**: a draft waiting for you to start it, waiting for your
    answer or approval in its thread, its last turn failed, it handed
    off as blocked ("Blocked: <summary>") or gave up ("Gave up: <summary>"),
    its done handoff failed verification ("✗ Failed verification after its
    fix round: <summary>", or without "after its fix round" when the
    findings couldn't be sent back; "✗ CI failed on #41 …" when every
    criterion passed but CI failed), or it couldn't be verified ("Couldn't
    verify: <summary>").
  - **Ready for review**: it handed off as done and passed ("✓ Verified:
    <summary>"), or it handed off while verification was off ("Unverified:
    <summary>"), and it has no open pull request.
  - **Verifying**: its verifier is starting or checking ("Verifying:
    <summary>"), or every criterion passed and it waits for CI ("Waiting for
    CI on #41: <summary>"). **Verifier** opens the hidden verifier thread.
  - **Working**: its thread is running, starting, waiting to start or
    stopping, as while it fixes findings sent back to it.
  - **Landing**: as Ready for review, with its pull request open, approved
    or not.
  - **Idle**: its turn ended without a handoff.
  - **Done**: resolved, stopped or archived through `crew_close`, its pull
    request merged ("Merged #41"), or its thread was archived or deleted.

A row placed by a verdict has a **Verdict** button. It opens the verdict
under the row: how many criteria passed, the commit checked and the provider
and model it ran on, then each criterion with Pass, Fail or Unverifiable. A
failed or unverifiable criterion shows its evidence; a passed one folds it
away until you open it. Findings follow, and **Open verifier thread** opens
the verifier. What CI said about the commit follows the model: passed, failed
with the failed checks, not checked and why, or still to finish. A verdict
that couldn't be had shows why.

A handoff places its crew until the crew's thread starts another turn: type
into a crew that handed off and it moves to Working, then to Idle if it ends
without a new handoff. A row with a thread opens it. Rows move between groups
as the threads change, without a reload. A thread status this plugin doesn't know shows as
Idle.

## Memory files

Each coordinating thread has its own folder on the bb server:
`<bb data dir>/plugins/coordinator/memory/<coordinator id>/`. The server log
names the parent folder when the plugin loads. It starts with:

- `MEMORY.md`: the index of the files.
- `GOAL.md`: the goal typed in the composer.
- `PLAN.md`: the plan.
- `PREFERENCES.md`: the user's standing preferences, one per line.
- `CREW.md`: rules every crew thread will follow.
- `DIGEST.md`: the latest summary for the user.

The thread may add others, such as `notes/api.md`.

## Read and edit memory

Press **Memory** on a row in the panel. Each save wakes the coordinating
thread with "The user edited <file>". The page shows the folder's path on
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
  would wait for CI pass as "CI not checked" (see
  [Pull requests and CI](#pull-requests-and-ci)).
- **bb's git plugin** (`bb--git`, built in), to read the branch a crew has
  checked out as it hands off, and the coordinating thread's own working tree
  as each of its turns ends. When it can't read one, the crew keeps the branch
  recorded before (else bb's), and no edit warning is recorded.
- **An environment provider**, such as the boat-sandbox plugin, only for crews
  you want off the coordinating thread's machine.

## Limits

- **Wakes are not instant.** An update never interrupts a running turn: the
  coordinating thread reads it when its turn ends. Reminders come due within
  about a minute; a pull request change shows within a minute while CI runs or
  a verdict waits for it, else within five, because pull requests are polled,
  never pushed.
- **Edits are detected, not prevented.** They are read after a turn ends, a
  committed one isn't seen, and nothing is blocked or reverted.
- Reminders take no cron expressions and nothing finer than a minute.
- The plugin never merges, approves or comments on a pull request.
- The coordinating thread chooses no model for a crew; it gets the
  coordinating thread's unless you pick one in a draft's editor.
