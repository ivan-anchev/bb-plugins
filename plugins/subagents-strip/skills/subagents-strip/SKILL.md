---
name: subagents-strip
description: Explain the Subagents Strip, the live line above a bb thread's composer that counts the latest prompt's subagents and child threads, plus any still running, and how long they have taken, and opens into one row per subagent that expands to its report and steps and opens its full transcript in the side panel or its own thread; a Subagents tab in the side panel lists every subagent in the thread, grouped by the prompt it was launched after. Use when the user asks what the strip shows, why a subagent reads as running or done there, or why no strip appears.
---

# Subagents Strip

The Subagents Strip plugin draws one line above the composer of a thread whose
agent has started subagents or that has child threads. Clicking the line opens a list above it
of your latest prompt's subagents, plus any still running from an earlier prompt; clicking
again closes it. Every subagent in the thread, by prompt, is in the **Subagents** tab of the
side panel, which the list's "N previous subagents" row opens. It has no commands and no
settings.

## What it shows

- One provider icon per subagent (the three most recent, then "+N"), each with
  a status dot: blue running, green done, red failed, grey stopped.
- "N subagents", then what needs attention: running, failed, stopped, in that
  order ("41 subagents · 3 running · 1 failed · 1 stopped"). A count of zero is
  left out, and "done" shows only when nothing else is left ("5 subagents ·
  5 done"). It counts the subagents the list shows: the latest batch (see The
  Subagents tab) and any earlier one still running.
  On a narrow strip the time moves up beside "N subagents", so the counts keep
  to one line and the strip to two.
- The latest batch's time: from its first subagent's start to its last one's
  end, or to now while any of that batch's subagents runs, when it ticks once a
  second. It never spans batches.
- When every subagent has finished, the line dims until it is hovered,
  focused, or opened.

## The list

The list holds your latest prompt's subagents and any subagent still running
from an earlier prompt, oldest first, so the newest sits nearest the composer.
It has no batch labels.

When the thread has subagents the list leaves out, its first row is a quiet
"N previous subagents", followed by how many of them failed or stopped when
any did ("37 previous subagents · 1 failed · 1 stopped"), with a panel icon at
the right. N counts every subagent not in the list, so the list's count plus N
is the Subagents tab's total. A thread whose subagents are all in the list has
no such row.

- Clicking the row opens the Subagents tab, or switches to it when it is
  already open; the list stays open. The row reads as pressed while the
  side panel shows the tab.
- Clicking "1 failed" or "1 stopped" opens the tab on the newest subagent
  that ended that way, with its batch open and its row expanded.

Each row in the list shows:

- The provider icon with the same status dot.
- The subagent's description. A Codex subagent, which bb names by its path
  ("/root/counter_e"), shows its agent name ("counter_e"). A child thread
  shows its thread title.
- While it runs, its trail's latest line in bb's compact words ("Running 7
  commands, exploring 2 files"; a lone step counted the same way, "Running 1
  command"), never the raw command; a question or approval as its own line
  ("Asking a question"), or the first line of what it said ("Starting…"
  before its first step). Reasoning is skipped. In the trail and the
  transcript a step still under way reads in the present tense ("Running
  sleep 9", "Reading README.md") and switches to the past once it ends.
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
focus on the row. A closed row forgets its "Show more" and "Show N earlier". The expanded row shows, top to bottom:

- A meta line: "started 13:58", "ran 4m 48s" once it has finished, the step
  count (reasoning not counted), and its tool calls and tokens ("61.2k
  tokens"), total tokens for both kinds. A Claude Code background agent's task
  reports both. A child thread counts its own commands and other tool rows,
  and takes its tokens from its latest token-usage event, which it may not
  have yet. Codex subagents report neither. Parts with nothing to report are
  left out.
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
  - A message that only opened a browser preview (bb's `::browser-preview`
    directive, which bb's chat draws as a live browser view) reads "Opened a
    browser preview"; in a longer message the directive line is left out.
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

## The Subagents tab

The Subagents tab lists every subagent in the thread. Its header is the
thread's census: "41 subagents" over "3 running · 1 failed · 1 stopped" (or
"41 done"). Clicking a count opens the newest subagent it counts, the way the
list's "1 failed" does. There is one Subagents list per thread; it is what
bb's new-tab launcher opens too, under Actions.

Below the header the subagents are in batches, newest first, back to the
thread's first. A batch is one of your prompts and every subagent launched
after it until your next prompt, however many turns the agent took: the turns
it takes on its own (Claude Code resuming when a background agent finishes)
and the ones a bb notice starts ("reviewer 05 r1 completed") fold into the
prompt before them and are never labels. A prompt you send while the agent is
still working, queued or steered into its turn, ends the batch before it: what
the agent launches after you sent it is the new prompt's. Subagents launched
before your first prompt share one batch under the thread's first message, or
"Before the first prompt" when there is none. A prompt that launched nothing
has no batch.

Each batch starts with a quiet label, small and muted, with no card until you
point at it:

- a caret that opens or closes the batch;
- the prompt's clock time ("11:55");
- the prompt's first line, without wrapping quotes or a filler lead-in ("ok,",
  "now,", "lets", "so", "please"), its full text in the tooltip;
- the batch's counts ("1 running, 8 done"), running and failed in their
  colours; on a narrow tab, under the prompt.

The latest batch starts open, and so does any older batch with a subagent
still running; every other batch starts closed, its counts still showing an
old failure in red. Your clicks override that until you reload; they are kept
by thread and by prompt, so switching tabs or history arriving never moves
them. The tab remembers them for the eight threads you last clicked in.
While a batch's rows scroll under its label, the label stays at the top of
the tab, with a hairline beneath it. The latest batch is not marked as the
one in the strip.

Each batch holds one row per subagent launched in it, oldest first, the same
row as the list's, expanding the same way; its Open thread opens that
subagent's transcript in a tab of its own beside the list, which stays open.
The list stays live while it shows.

## The transcript tab

Open thread opens a Subagents tab of its own for that subagent, titled with
its description, or switches to it when that subagent's tab is already open,
so each subagent has at most one tab, and several can sit beside the list. A Claude Code or Codex subagent is not a bb thread, so this
never navigates away. On a view without a side panel, Open thread does nothing.

A child thread is a real bb thread, so its Open thread goes to that thread
instead, in place of the current one, with no tab.

The tab shows the avatar, description, status word, and elapsed time over the
same meta line as the row, then the subagent as bb's chat shows it when you
expand the same subagent there, in the same order and words:

- what the subagent said, as markdown;
- its work between two messages folded into the same lines as the row's trail
  ("Explored 3 files, ran 2 commands", "1 error" when some failed). Click a
  line to open it to its steps, one per line:
  - its reasoning as a collapsed, muted "Thinking" line that opens to the
    thought; reasoning that stands alone between two messages is its own
    Thinking line (the row's trail and step count leave reasoning out);
  - each command as one line that opens to its output;
  - each file read, edit, search, page fetch, and tool call as one line, with
    "failed" when it failed and its time since the subagent started;
- questions and approvals as their own lines;
- at the end, the report in full, the error, or the stopped note. bb's chat
  shows the launch receipt there for a background agent; the tab shows what
  the agent handed back.

Inside a group, a step reads as it does on the row's trail ("Ran cat
notes.md"), not as bb's compact form ("Read notes.md"). A message that only
opened a browser preview is one line, "Opened a browser preview"; in a longer
message the directive line is left out. Other bb chat directives show as
their raw text.

While the subagent runs, new lines appear at the end and the tab stays at the
bottom unless you scroll up. Its latest line is live as on the row: it
shimmers, and a group reads in the present tense ("Running 3 commands"); here
that can also be the subagent thinking. The report appears when it finishes. The tab
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

The Subagents tab shows every one in the thread, in the batch of the prompt it
was launched after; the strip shows the latest batch's and any still running.
A child thread belongs to the batch of the parent turn that was under way when
it was created.

The live updates read only the thread's latest timeline segments (the last
20) in full. The history before them is read on opening the thread in outline
(bb's deferred content: every subagent and message, without a subagent's
steps and report; about 0.65 MB for a thread of 45 subagents), so "N previous
subagents" is right before anything opens. While the Subagents tab shows, it reads
that history in full, page by page back to the first row; meanwhile an earlier
row reads "Loading its steps and report…". Switching to another tab or closing
the panel before it finishes stops the read; showing the tab again starts it
over. Once read in full it stays read. History bb rewrites or compacts is
read again. Child
threads are read the same deferred way, which leaves out nothing a row shows.

Left out: subagents a subagent starts, a child's own child threads, hidden and
archived child threads, and workflow workers, which are not children of the
thread.

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
