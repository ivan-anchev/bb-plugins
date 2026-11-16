---
name: crew-work
description: The playbook of a crew thread, a child thread a coordinating thread started to do one piece of its work on its own branch. Use in every turn of a crew thread, to read the brief and done-criteria in its first message, follow the crew rules (CREW.md), read the coordinating thread's memory with crew_memory_read, tell its messages from the user's, and end its work with one crew_handoff call that reports done, blocked or gave-up with evidence for each done-criterion.
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

## Handing off

Your coordinator reads one thing from you: your handoff. bb's own report to
your parent thread is off, so your chat answer doesn't reach it. When you
finish, get stuck or give up, call `crew_handoff` once, as your last action,
then stop:

- **status**: `done` when every done-criterion is met and committed;
  `blocked` when you need a decision or hit a problem you didn't cause;
  `gave-up` when a retried approach failed again.
- **summary**: one line, up to 120 characters, your coordinator can pass on
  as it is. Don't open it with the status: the board shows it after the
  status, as in "Blocked: <summary>".
- **did**, **evidence**, **concerns**, **deviations**, **findings**: lists of
  up to 50 items, each up to 2,000 characters. Evidence takes each
  done-criterion in turn: the command you ran and what it printed. Use `[]`
  for an empty list.
- **headSha** (done only, required): `git rev-parse HEAD` after your last
  commit. **prUrl**: the pull request, if you opened one.

Say plainly when a criterion fails or you couldn't check it. Never report
`done` without having run every check.

A turn that ends without a handoff tells your coordinator you stopped without
reporting, with your last answer attached. If the user types to you after you
handed off, answer them; if that changes your work, hand off again.
