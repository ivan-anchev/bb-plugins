When an agent hands work to subagents, bb folds them into the thread's step list, and a background subagent reads as finished the moment it launches. This plugin adds a live strip above the composer that counts the thread's subagents and how long they have taken, and opens into one row per subagent with its current step or result.

## What you get

- **One line above the composer.** The provider's icon for each subagent, "3 subagents", then "2 running · 1 done", and the time since the first one started.
- **One row per subagent.** Click the line to open the list above it: each row shows the provider's icon with a status dot, what the subagent was asked to do, its latest step while it runs or the first line of its report once it finishes, and how long it ran. Click again to close it.
- **Calm motion.** A row's text rolls to the new step and its dot changes colour; the running step shimmers. With reduced motion turned on, nothing shimmers and changes are instant.
- **The real status of background agents.** A background agent counts as running from launch until it finishes, even after the parent agent's turn has ended.
- **The latest batch.** The strip shows the subagents of the most recent turn that started any, plus any older ones still running.
- **A live clock.** The time ticks once a second while any subagent runs and stops when the last one finishes.
- **Quiet when done.** When every subagent has finished, the strip dims until you point at it or open it.
- **Nothing when there is nothing.** A thread without subagents shows no strip, and bb's own "Running N background agents" bar stays as it is.

## How it works

The strip reads the thread's timeline and its background-task events through bb's own API, in your browser, and updates when the thread changes. It has no server logic, settings, commands, or network access beyond bb.

Status comes from Claude Code's background-task events. Other providers' subagents show the status bb's timeline gives them; Codex and ACP subagents have not been checked live.
