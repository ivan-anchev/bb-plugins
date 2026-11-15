Experimental: it may break with a bb update.

Start a long-lived coordinating thread for a body of work. Open its panel in the navigation rail and press New: bb's own new-thread composer opens, already set to a fresh worktree and auto permissions, and the goal you type starts the thread. From its first turn it has its rules, its playbook skill and three tools: one to catch up on its memory, one to read a memory file and one to write one. Its memory is a folder of markdown files on the bb server, seeded with your goal: an index, the goal, a plan, your preferences, rules for its crew and a digest. The panel lists every coordinating thread, by project, and each one's Memory button opens an editor over the same files that shows the folder's path. Every write names the version it replaces, so neither you nor the thread can silently overwrite the other: a refused save keeps your text beside the newer version.

## What you get

- **A panel in the navigation rail.** It lists every coordinating thread bb still lists, under its project, newest first, each with bb's status glyph. A row opens its thread.
- **New, with bb's own composer.** New in the panel's title bar opens bb's new-thread composer, seeded with a fresh worktree of the default branch and auto permissions so a stray edit never lands in your checkout and no approval holds the thread. Every picker works as usual. Submit, and the thread opens.
- **A thread with a role from its first turn.** It gets rules that make it plan, delegate and track rather than code, the `coordinating` playbook skill, and three tools: `crew_catch_up`, which returns its memory files in full, `crew_memory_read`, which reads one of them, and `crew_memory_write`, which writes one. It keeps its plan, your standing preferences and a digest in those files. No other thread is offered these tools, and a call from one is refused.
- **Memory you can read and edit.** Each coordinating thread has a folder of markdown files on the bb server: `MEMORY.md` (the index), `GOAL.md` (your goal), `PLAN.md`, `PREFERENCES.md`, `CREW.md`, `DIGEST.md`, and any others it adds, such as `notes/api.md`. A row's **Memory** button opens an editor over them that shows the folder's path. You can also edit them on the server's disk; the thread reads the new text on its next catch-up.
- **No silent overwrites.** Every write names the version of the file it replaces. If the file changed since, nothing is written: the thread gets the current text to merge into, and the editor keeps your text with the newer version beside it, for you to merge and save, or to take the newer version.

## How it works

Which thread holds which role lives in the plugin's own SQLite database on the bb server, never in the thread's metadata, which anyone can write. The memory files sit beside that database, in `memory/<coordinator id>/`. A version is a hash of a file's content, and a write replaces the file through a temporary file and a rename, so a crash never leaves half a file.

## Not yet

The coordinating thread can't yet start crew threads; it replies with what it would delegate. Saving in the editor doesn't wake it: it reads your edit at the start of its next turn.
