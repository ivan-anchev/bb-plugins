---
name: subagents-strip
description: Explain the Subagents Strip, the live line above a bb thread's composer that counts the thread's subagents, how many are running and done, and how long they have taken. Use when the user asks what the strip shows, why a subagent reads as running or done there, or why no strip appears.
---

# Subagents Strip

The Subagents Strip plugin draws one line above the composer of a thread whose
agent has started subagents. It has no commands and no settings.

## What it shows

- One provider icon per subagent (the three most recent, then "+N"), each with
  a status dot: blue running, green done, red failed, grey stopped.
- "N subagents", then the counts in a fixed order: running, done, failed,
  stopped. A count of zero is left out.
- The wall-clock time from the first subagent's start to the last one's end, or
  to now while any runs. It ticks once a second.

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
