---
name: crew-board
description: Explain the coordinating-thread plugin (package bb-plugin-coordinator). The panel in bb's navigation rail starts long-lived coordinating threads with bb's composer and lists them. A coordinating thread keeps its memory as markdown files on the bb server, which the user edits too, and starts crew threads that each work on their own branch from a brief and done-criteria, or saves them as drafts the user edits and starts. A crew ends with a handoff; a done one is checked by an independent hidden verifier before the thread hears of it, unless the user switched verification off. The Board shows the digest and every crew under Needs you, Ready for review, Verifying, Working, Idle or Done with each verdict. Use when the user asks how to start a coordinating thread or a crew, what the board, a group, a row or a verdict means, how verification works or how to turn it off, what a handoff or an update is, why the thread woke, where memory lives, which thread has which crew_ tools, how drafts work, or what is missing.
---

# Coordinating threads

This plugin turns one ordinary bb thread into a long-lived **coordinating
thread**: it holds a goal, keeps its memory in files, plans the work, and
hands each piece to a **crew thread**. It has no CLI commands and no settings.

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
- seven tools:
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
    manage its crews (below).

  A name that leaves the memory folder or doesn't end in `.md` is rejected.
  Its rules tell it to keep its plan in `PLAN.md`, each standing preference
  you give it in `PREFERENCES.md`, and a digest in `DIGEST.md`.

A crew thread is offered only `crew_memory_read` and `crew_handoff`, and a
verifier thread only `crew_memory_read` and `crew_verdict`. Any other thread
is offered none of these tools, and a call from one is refused. No tool can
turn verification on or off. A thread's role comes
from the plugin's own database, so editing a thread's metadata grants nothing.

## Crews

A crew is an ordinary child thread of the coordinating thread, which starts
it with `crew_start`:

- **Where it runs**: a fresh worktree of the project's default branch on the
  coordinating thread's machine, on its own branch; or, when the coordinating
  thread names one, an environment provider such as `boat-sandbox`. It runs
  with auto permissions.
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

A `done` handoff is announced only together with its verdict (see
[Verification](#verification)); a blocked or gave-up one, and everything
else, at once. The user turning verification on or off is an update too.

Each one wakes the coordinating thread with one short message: the plugin's
name in brackets, how many updates there are, and one line each, such as
`- c1 "Add retries" handed off: done, failed verification`,
`- c2 "Dead letters" handed off: blocked` or `- The user edited PLAN.md`. The
message reaches the thread as if you typed it, so it holds only facts the
plugin derived and the titles the thread gave its crews: never a crew's
summary, answer, error or question, nor a verifier's evidence. Those are in
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
- **What it does**: proves `git rev-parse HEAD` is the claimed commit and the
  tree is clean (otherwise every criterion fails), then runs what proves or
  disproves each done-criterion and quotes the output. It never edits,
  commits or pushes, and it gets none of the crew's own report. It ends with
  `crew_verdict`: each criterion `pass`, `fail` or `unverifiable`, with its
  evidence, and any findings. A verdict that skips, repeats or invents a
  criterion, or passes one on another commit, is refused.
- **Outcome**: derived, never stored. Verified only when every criterion
  passed; an unverifiable one is not a pass.
- **No verdict**: a verifier that ends a turn without one is reminded once;
  a second time, or a verifier bb wouldn't start or whose thread was
  archived, reads "Couldn't verify" with the reason.
- **A newer done handoff** from the same crew stops the older verifier, and
  only the newer handoff is checked and announced.
- **A verifier that never started** (the plugin reloaded at that moment) is
  started by the once-a-minute tick.

Turn verification off or on with the switch at the top of the board (or on
the New page when starting). It applies to handoffs made after it: turning it
back on doesn't check earlier ones. Each change tells the coordinating
thread. With it off, a done handoff waits under Ready for review as
"Unverified: <summary>".

## The board

The **Board** tab in a coordinating thread's side panel, and the **Board**
page from its row in the panel, show the same board:

- **Verify done handoffs**: the switch for this coordinating thread.
- **Digest**: `DIGEST.md`, the coordinating thread's latest summary for you,
  and when it last changed.
- **Crews**, each with its id, title, a one-line headline and its branch,
  grouped:
  - **Needs you**: a draft waiting for you to start it, waiting for your
    answer or approval in its thread, its last turn failed, it handed
    off as blocked ("Blocked: <summary>") or gave up ("Gave up: <summary>"),
    its done handoff failed verification ("✗ Failed verification:
    <summary>"), or it couldn't be verified ("Couldn't verify: <summary>").
  - **Ready for review**: it handed off as done and every criterion passed
    ("✓ Verified: <summary>"), or it handed off while verification was off
    ("Unverified: <summary>").
  - **Verifying**: its verifier is starting or checking ("Verifying:
    <summary>"). **Verifier** opens the hidden verifier thread.
  - **Working**: its thread is running, starting, waiting to start or
    stopping.
  - **Idle**: its turn ended without a handoff.
  - **Done**: resolved, stopped or archived through `crew_close`, or its
    thread was archived or deleted.

A row placed by a verdict has a **Verdict** button. It opens the verdict
under the row: how many criteria passed, the commit checked and the provider
and model it ran on, then each criterion with Pass, Fail or Unverifiable. A
failed or unverifiable criterion shows its evidence; a passed one folds it
away until you open it. Findings follow, and **Open verifier thread** opens
the verifier. A verdict that couldn't be had shows why.

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
unsaved changes; switching files keeps them. **Save** (or Ctrl/Cmd+S)
writes the file. While you have unsaved changes, Esc doesn't leave the page.

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

## Not yet

- A failed verdict isn't sent back to the crew: the coordinating thread
  decides what to do with it.
- A pull request's CI isn't part of a verdict.
- Pull request and CI changes don't wake the thread.
- The coordinating thread chooses no model for a crew; it gets the
  coordinating thread's unless you pick one in a draft's editor.
