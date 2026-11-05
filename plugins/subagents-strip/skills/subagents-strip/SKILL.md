---
name: subagents-strip
description: Explain the Subagents Strip, the live line above a bb thread's composer that counts the thread's subagents and how long they have taken, and opens into one row per subagent. Use when the user asks what the strip shows, why a subagent reads as running or done there, or why no strip appears.
---

# Subagents Strip

The Subagents Strip plugin draws one line above the composer of a thread whose
agent has started subagents. Clicking the line opens a list of the subagents
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
- The subagent's description.
- While it runs, its latest step, led by its verb: "Ran" and the command,
  "Read" or "Edited" and the file, "Searched" and the query, "Fetched" and
  the page; a tool by its title, or the first line of what it said
  ("Starting…" before its first step). Reasoning is skipped.
- Once it finishes, the first line of its report ("Finished without a report"
  when it handed none back), the first line of its error, or "Stopped".
- How long it ran, ticking while it runs.

The step text rolls when it changes and shimmers while the subagent runs.
With the system's reduced-motion setting on, nothing shimmers and every
change is instant; the dots and words still show each state.

## Which subagents

The subagents of the most recent turn that started any, plus any older ones
still running. Subagents a subagent starts are not counted.

## Status

- A Claude Code background agent is running from launch until its background
  task completes, even after the parent turn has ended. bb's own timeline marks
  it finished at launch; the strip reads the task's events instead.
- Other providers' subagents use the status bb's timeline gives them. Codex and
  ACP subagents have not been checked live.

## When no strip appears

A thread with no subagents shows nothing. bb's own "Running N background
agents" bar is separate and is never changed by this plugin.
