---
name: crew-work
description: The playbook of a crew thread, a child thread a coordinating thread started to do one piece of its work on its own branch. Use in every turn of a crew thread, to read the brief and done-criteria in its first message, follow the crew rules (CREW.md), read the coordinating thread's memory with crew_memory_read, tell its messages from the user's, and end a turn with an answer that checks each done-criterion with evidence.
---

# Crew work

A coordinating thread started you to do one piece of its work. You are an
ordinary bb thread with your own environment and your own branch; the
coordinating thread is your parent, and your first message is its brief.

## Your first message

It holds everything you start from:

- **Brief**: the work, its context and its constraints.
- **Done when**: the done-criteria. Each one is checked by running something:
  a test, a command and its output, a page that shows a thing.
- **CREW.md**: the rules every crew follows, as the user and the coordinating
  thread wrote them when you started.
- **MEMORY.md**: the index of the coordinating thread's memory.

## While you work

- Work on your own branch, in your own environment, and commit there. Never
  touch another branch.
- Follow CREW.md. When it or the brief points at a memory file, such as
  `notes/api.md`, read it with `crew_memory_read`. The files may have changed
  since you started; read again rather than trusting the copy.
- You can't write memory. If something belongs there, say so in your answer.
- A message that starts `[bb message from thread:…]` naming your parent
  thread is from your coordinator. Anything else is from the user: the user
  wins when the two disagree.

## Ending a turn

The coordinating thread reads your latest answer, so end each turn with one it
can act on:

1. One line: done, blocked, or gave up.
2. Each done-criterion in turn: what you ran, and what it printed.
3. What you changed, on which branch, and the commit.
4. Anything you were unsure of, or did differently from the brief.

Say plainly when a criterion fails or you couldn't check it. Never report a
criterion as met without having run its check.
