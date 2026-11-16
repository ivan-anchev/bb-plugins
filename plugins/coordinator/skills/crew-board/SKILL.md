---
name: crew-board
description: Explain the coordinating-thread plugin (package bb-plugin-coordinator). Its panel in bb's navigation rail starts long-lived coordinating threads with bb's own composer and lists them. A coordinating thread keeps its memory as markdown files on the bb server (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md), which the user edits too without either side overwriting the other, and starts crew threads, child threads that each work on their own branch from a brief and done-criteria. The Board, a tab in the coordinating thread and a page in the panel, shows the digest and every crew under Needs you, Working, Idle or Done. Use when the user asks how to start a coordinating thread or a crew, what the board, its groups or a row mean, where the memory files are or how to edit them, why a save or a write was refused, why a thread has or lacks the crew_ tools, how to message or close a crew, or what the plugin can't do yet.
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
4. Type the goal and submit. The new thread opens.

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
  - `crew_catch_up` returns the board, then its core memory files in full,
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

A crew thread is offered only `crew_memory_read`. Any other thread is offered
none of these tools, and a call from one is refused. A thread's role comes
from the plugin's own database, so editing a thread's metadata grants nothing.

## Crews

A crew is an ordinary child thread of the coordinating thread, which starts
it with `crew_start`:

- **Where it runs**: a fresh worktree of the project's default branch on the
  coordinating thread's machine, on its own branch; or, when the coordinating
  thread names one, an environment provider such as `boat-sandbox`. It runs
  with auto permissions.
- **Its first message**: the brief, the done-criteria (1 to 12, required), and `CREW.md` and `MEMORY.md`
  as they were at that moment. Put rules every crew follows in `CREW.md`.
- **Its id**: `c1`, `c2`… within its coordinating thread. Its thread is
  titled with the crew's title and sits under the coordinating thread in
  bb's sidebar.
- **What it gets**: its rules, the `crew-work` skill and `crew_memory_read`.
  It can't write memory or start crews.

The coordinating thread messages a crew with `crew_message` (it arrives
marked as from the coordinating thread, not from you), reads it with
`crew_read`, and closes it with `crew_close`: **resolve** accepts its work,
**stop** stops its turn (recorded once bb confirms the thread stopped), and
**archive** archives its thread. You can open any crew's thread and type into
it like any thread.

Archiving or deleting the coordinating thread archives or deletes its crews
with it.

## The board

The **Board** tab in a coordinating thread's side panel, and the **Board**
page from its row in the panel, show the same board:

- **Digest**: `DIGEST.md`, the coordinating thread's latest summary for you,
  and when it last changed.
- **Crews**, each with its id, title, a one-line headline and its branch,
  grouped:
  - **Needs you**: waiting for your answer or approval in its thread, its
    last turn failed, or bb never started its thread.
  - **Working**: its thread is running, starting, waiting to start or
    stopping.
  - **Idle**: its turn ended and it waits for a message.
  - **Done**: resolved, stopped or archived through `crew_close`, or its
    thread was archived or deleted.

A row with a thread opens it. Rows move between groups as the threads
change, without a reload. A thread status this plugin doesn't know shows as
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

Press **Memory** on a row in the panel. The page shows the folder's path on
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

- Crews don't report back by themselves: bb's own report to the parent is
  off for them, so the coordinating thread checks the board and reads each
  crew with `crew_read`. Handoffs come later.
- The coordinating thread chooses no model for a crew; it gets the project's
  default.
- Saving in the Memory editor doesn't wake the thread; it reads your edit at
  the start of its next turn.
