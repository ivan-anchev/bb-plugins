---
name: crew-board
description: Explain the coordinating-thread plugin (package bb-plugin-coordinator), which starts a long-lived coordinating thread for a body of work from its panel in bb's navigation rail, where New opens bb's own new-thread composer seeded with a fresh worktree and auto permissions, and the goal typed there starts the thread; the thread has its rules, the coordinating skill and the crew_catch_up and crew_memory_read tools from its first turn, and keeps its memory as markdown files on the bb server (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md), seeded with the goal. Use when the user asks how to start a coordinating thread, what the panel lists, where a coordinating thread's memory files are or what each holds, why a thread has or lacks the crew_ tools, or what the plugin can't do yet.
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
newest first, with bb's status glyph. A row opens its thread. An archived or
deleted thread drops off the list.

## What the thread gets

From its first turn the thread has:

- its rules: call `crew_catch_up` first at the start of every turn, never edit
  project files, build or commit itself, and plan with checkable done-criteria;
- the `coordinating` skill, its playbook;
- two tools:
  - `crew_catch_up` returns its memory files in full, in a fixed order, up to
    40,000 characters; files past that are named so it can read them alone.
  - `crew_memory_read` reads one memory file by name, such as `PLAN.md` or
    `notes/api.md`. A name that leaves the memory folder or doesn't end in
    `.md` is rejected.

Any other thread is offered neither tool, and a call from one is refused. A
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

Edit them in any editor on the server's disk; the thread reads the new text
on its next `crew_catch_up`.

## Not yet

The coordinating thread can't yet write its memory or start crew threads, so
it replies with its plan and what it would delegate.
