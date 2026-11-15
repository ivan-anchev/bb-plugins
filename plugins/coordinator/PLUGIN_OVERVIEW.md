Experimental: it may break with a bb update.

Start a long-lived coordinating thread for a body of work. Open its panel in the navigation rail and press New: bb's own new-thread composer opens, already set to a fresh worktree and auto permissions, and the goal you type starts the thread. From its first turn it has its rules, its playbook skill and two tools, one to catch up on its memory and one to read a memory file. Its memory is a folder of markdown files on the bb server, seeded with your goal: an index, the goal, a plan, your preferences, rules for its crew and a digest. The panel lists every coordinating thread, by project.

## What you get

- **A panel in the navigation rail.** It lists every coordinating thread bb still lists, under its project, newest first, each with bb's status glyph. A row opens its thread.
- **New, with bb's own composer.** New in the panel's title bar opens bb's new-thread composer, seeded with a fresh worktree of the default branch and auto permissions so a stray edit never lands in your checkout and no approval holds the thread. Every picker works as usual. Submit, and the thread opens.
- **A thread with a role from its first turn.** It gets rules that make it plan, delegate and track rather than code, the `coordinating` playbook skill, and two tools: `crew_catch_up`, which returns its memory files in full, and `crew_memory_read`, which reads one of them. No other thread is offered these tools, and a call from one is refused.
- **Memory you can read and edit.** Each coordinating thread has a folder of markdown files on the bb server: `MEMORY.md` (the index), `GOAL.md` (your goal), `PLAN.md`, `PREFERENCES.md`, `CREW.md` and `DIGEST.md`. Edit them on the server's disk, and the thread reads the new text on its next catch-up.

## How it works

Which thread holds which role lives in the plugin's own SQLite database on the bb server, never in the thread's metadata, which anyone can write. The memory files sit beside that database, in `memory/<coordinator id>/`.

## Not yet

The coordinating thread can't yet write its memory or start crew threads; it replies with its plan and what it would delegate.
