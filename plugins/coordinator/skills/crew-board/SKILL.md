---
name: crew-board
description: Explain the coordinating-thread plugin (package bb-plugin-coordinator), which starts a long-lived coordinating thread from its panel in bb's navigation rail, where New opens bb's own new-thread composer seeded with a fresh worktree and auto permissions. The thread has its rules, the coordinating skill and the crew_catch_up, crew_memory_read and crew_memory_write tools from its first turn, and keeps its memory as markdown files on the bb server (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md and any it adds). A row's Memory button opens an editor over those files that shows the folder's path; every write names the version it replaces, so a stale one is refused instead of overwriting. Use when the user asks how to start a coordinating thread, what the panel lists, where the memory files are or what each holds, how to read or edit them, why a save or a crew_memory_write was refused, why a thread has or lacks the crew_ tools, or what the plugin can't do yet.
---

# Coordinating threads

This plugin turns one ordinary bb thread into a long-lived **coordinating
thread**: it holds a goal, keeps its memory in files, and plans the work. It
has no CLI commands and no settings.

## Start one

1. Open the plugin's panel in bb's navigation rail.
2. Press **New** in its title bar.
3. bb's own new-thread composer opens, seeded with your first project (in the
   sidebar's order), a fresh worktree of its default branch on the machine
   running bb, and **auto** permissions. Change any picker as with any new
   thread.
4. Type the goal and submit. The new thread opens.

The panel lists every coordinating thread bb still lists, under its project,
newest first, with bb's status glyph. A row opens its thread, and its
**Memory** button opens its memory files. An archived or deleted thread drops
off the list.

## What the thread gets

From its first turn the thread has:

- its rules: call `crew_catch_up` first at the start of every turn, never edit
  project files, build or commit itself, and plan with checkable done-criteria;
- the `coordinating` skill, its playbook;
- three tools:
  - `crew_catch_up` returns its core memory files in full, each with its
    version, in a fixed order, up to 40,000 characters; files past that are
    named so it can read them alone, and so is every other memory file.
  - `crew_memory_read` reads one memory file by name, such as `PLAN.md` or
    `notes/api.md`, with its version.
  - `crew_memory_write` writes one memory file whole, naming the version it
    read (or none, to create a file). If the file changed since, nothing is
    written and it gets the current text to merge into and write again.

  A name that leaves the memory folder or doesn't end in `.md` is rejected.
  Its rules tell it to keep its plan in `PLAN.md`, each standing preference
  you give it in `PREFERENCES.md`, and a digest in `DIGEST.md`.

Any other thread is offered none of these tools, and a call from one is
refused. A
thread's role comes from the plugin's own database, so editing a thread's
metadata grants nothing.

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

- The coordinating thread can't start crew threads yet, so it replies with
  what it would delegate.
- Saving in the Memory editor doesn't wake the thread; it reads your edit at
  the start of its next turn.
