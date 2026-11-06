---
name: subagents-strip
description: Explain the Subagents Strip, the live line above a bb thread's composer that counts the thread's subagents and child threads and how long they have taken, and opens into one row per subagent that expands to its report and steps and opens its full transcript in the side panel or its own thread. Use when the user asks what the strip shows, why a subagent reads as running or done there, or why no strip appears.
---

# Subagents Strip

The Subagents Strip plugin draws one line above the composer of a thread whose
agent has started subagents or that has child threads. Clicking the line opens a list of the subagents
above it; clicking again closes it. It has no commands and no settings.

## What it shows

- One provider icon per subagent (the three most recent, then "+N"), each with
  a status dot: blue running, green done, red failed, grey stopped.
- "N subagents", then the counts in a fixed order: running, done, failed,
  stopped. A count of zero is left out.
- The wall-clock time from the first subagent's start to the last one's end, or
  to now while any runs. It ticks once a second.
- When every subagent has finished, the line dims until it is hovered,
  focused, or opened.

## The list

One row per subagent, oldest at the top, so the newest sits nearest the
composer. Each row shows:

- The provider icon with the same status dot.
- The subagent's description. A Codex subagent, which bb names by its path
  ("/root/counter_e"), shows its agent name ("counter_e"). A child thread
  shows its thread title.
- While it runs, its latest step, led by its verb: "Ran" and the command,
  "Read" or "Edited" and the file, "Searched" and the query, "Fetched" and
  the page; a tool by its title, or the first line of what it said
  ("Starting…" before its first step). Reasoning is skipped. A step still
  under way reads in the present tense ("Running sleep 9", "Reading
  README.md") and switches to the past once it ends, in the trail and the
  transcript too.
- Once it finishes, the first line of its report ("Finished without a report"
  when it handed none back), the first line of its error, or "Stopped". A
  subagent that hands nothing back, like a Codex one, reports its last
  message, which then appears once, as the report, and not again as its last
  step.
- How long it ran, ticking while it runs.

The step text rolls when it changes and shimmers while the subagent runs.
With the system's reduced-motion setting on, nothing shimmers and every
change is instant; the dots and words still show each state.

## An expanded row

Clicking a row expands it in place; clicking another row closes the first, so
one is open at a time. Esc, or clicking the row again, closes it and leaves
focus on the row. The expanded row shows, top to bottom:

- A meta line: "started 13:58", "ran 4m 48s" once it has finished, the step
  count (reasoning not counted), and, when a background-task event reported
  usage, its tool calls and tokens ("61.2k tokens"). Only a Claude Code
  background agent's task reports usage, so Codex subagents and child threads
  show no tool calls or tokens. Parts with nothing to report are left out.
- The outcome, once it has finished: the report rendered as markdown, cut to
  six lines with "Show more" when it is longer; the error in full; or
  "Stopped after 35s. Nothing was handed back."
- The trail: the last six lines on a rail, oldest first, with "Show N
  earlier" for the rest. Steps fold into lines the way bb's chat folds them
  when you expand the same subagent there, with the same words: "Explored 3
  files, ran 2 commands", "Edited 2 files", and "2 errors" when some failed.
  - Where bb's chat shows the work as done, everything between two messages
    is one line: a delegation whose row has settled, which for a Claude Code
    background agent is from its launch, and each finished turn of a child
    thread. A single step stays its own line, with an icon for what it did,
    the same words as the row's step line, and "failed" when it failed.
  - Where bb's chat shows it still running (a pending delegation row, a child
    thread's turn under way), only neighbouring steps of one kind fold
    ("Running 2 commands"); a message still folds the whole run before it.
  - Messages, questions, approvals, and a `bb thread tell` that went through
    (bb shows it as a message) are their own lines and split the runs. A tell
    is recognised in its plain form only, one command of plain or quoted
    words; one sent through a heredoc, a variable, `sh -c`, or a redirect
    folds as a command here, though bb's chat shows it as a message.
  - Click a line to open it to its steps, one per line; click again to close
    it.
  - Each line shows its time since the subagent started ("4:12").
  - While the subagent runs, its latest line is the live one: it shimmers, and
    a group reads in the present tense, even where bb's chat shows the work as
    done (a Claude Code background agent: "Running 3 commands" here, "Ran 3
    commands" there). A line a message or a finished turn closed is never
    live, and when bb's latest line is one the trail hides (the subagent
    thinking), no line is. Liveness never changes which steps share a line.
    Once the subagent finishes, every line reads as bb's chat reads it. The
    body stays scrolled to the newest line unless you scroll up.
  - Reasoning and the hand-back (the report) never show as steps, though bb
    counts the hand-back as a tool ("ran 1 tool").
  - A subagent whose provider sends no steps shows no trail.

The body scrolls inside a fixed height. Below it, **Open thread** and "Esc to
collapse" (the hint is hidden on a narrow strip). A subagent whose provider
sends no steps has no Open thread.

## The transcript tab

Open thread opens a side-panel tab titled with the subagent's description, or
switches to it when that subagent's tab is already open, so each subagent has
at most one tab. A Claude Code or Codex subagent is not a bb thread, so this
never navigates away. On a view without a side panel, Open thread does nothing.

A child thread is a real bb thread, so its Open thread goes to that thread
instead, in place of the current one, with no tab.

The tab shows the avatar, description, status word, and elapsed time over the
same meta line as the row, then every step in order:

- what the subagent said, as markdown;
- each command as one line that opens to its output;
- each file read, edit, search, page fetch, and tool call as one line, with
  "failed" when it failed and its time since the subagent started;
- its reasoning as a collapsed, muted "Thinking" block (the row's trail and
  step count leave reasoning out);
- at the end, the report in full, the error, or the stopped note.

While the subagent runs, new steps appear at the end and the tab stays at the
bottom unless you scroll up; the report appears when it finishes. The tab
reads the same live data as the strip, so both always show the same status.
Its subagent is saved with the tab, so it comes back after a reload; one
outside the loaded timeline reads "This subagent is outside the loaded
timeline."

## Which subagents

Two kinds of subagent appear, side by side in one list:

- **Delegations**: the subagents the thread's own agent started (Claude Code's
  Agent tool, Codex's native subagents), read from the thread's timeline.
- **Child threads**: bb threads whose parent is this thread, such as one made
  with `bb thread spawn --parent-thread <this thread>` or `--parent-self`.

The strip shows those of the most recent turn that started any, plus any older
ones still running. A child thread belongs to the parent turn that was under
way when it was created. Left out: subagents a subagent starts, a child's own
child threads, hidden and archived child threads, and workflow workers, which
are not children of the thread.

A child thread created while this thread is idle and nothing else changes
appears on the thread's next change (a turn, a delegate starting or settling,
returning to the window, or a reload), not at once; from then on it stays live.

## Child threads

A child thread reads entirely from bb's record of that thread:

- **Status** is the thread's own. Working, starting, stopping, or waiting on a
  question or an approval reads running; an errored thread reads failed; an
  idle one ended the way its latest turn did: done, or stopped when that turn
  was interrupted (`bb thread stop`, or Stop in bb).
- **Start** is when the thread was created; **end** is when its latest turn
  ended (its stop, for a stopped one), or its last update when the turn left
  no record of its end, as a thread that failed before starting does. Its time
  freezes there.
- **Report**: its closing message, the last thing it said. **Error**: the last
  error bb recorded, such as "Provider rejected request" or "Provisioning
  thread failed".
- **Steps**: the thread's own timeline, including "Provisioned thread", but not
  its brief or any later message sent to it.
- **Told something more**: sending a settled child a follow-up keeps it one
  row, in the turn that started it. It runs again, its time counting from its
  creation, then settles with the new closing message as its report.
- A child set not to wake its parent (`--parent-notifications off`) still
  settles in the strip: the strip watches each child itself.

## Status

- A Claude Code background agent is running from launch until its background
  task completes, even after the parent turn has ended. bb's own timeline marks
  it finished at launch; the strip reads the task's events instead.
- Stopping the thread stops its running background agents with it, and an
  agent the parent stops itself (Claude Code's TaskStop tool) ends the same
  way: each reads "Stopped", and its time freezes at how long it really ran.
- A background agent whose task fails reads "Failed" with the task's error.
  An agent call refused at launch, such as one naming an unknown agent type,
  fails at once: "0s", no steps, and bb's error as its detail.
- Other providers' subagents use the status bb's timeline gives them. Codex's
  native subagents were checked live; ACP subagents have not been.
- A child thread uses its own thread's status (see Child threads). One that
  bb itself never settles, such as a Codex child whose model the provider
  refuses, reads running for as long as bb shows it working.

## When no strip appears

A thread with no subagents and no child threads shows nothing. A child thread
just created under an idle thread shows on the thread's next change (see
Which subagents). bb's own "Running N background
agents" bar is separate and is never changed by this plugin.
