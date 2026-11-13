---
name: activity-sidebar
description: Explain the Activity Sidebar plugin, which replaces bb's thread list with one Activity list of every parent thread from every project, latest first, with pinned threads above it, each row showing the thread's agent, project initial, title, running subthreads and its state or age. Use when the user asks what the Activity list shows, why a thread is or isn't in it, what a row's corner glyph means, or how to switch back to bb's own list.
---

# Activity Sidebar

The Activity Sidebar plugin replaces the scrolling thread list in bb's sidebar.
The New thread button, search, navigation and footer stay bb's. It has no
commands and no settings.

## What the list shows

- **Pinned**, only while a thread is pinned, in bb's own pin order.
- **Activity**: every parent thread from every project, the one that most
  recently came back first: its turn ended or failed. Opening or reading a
  thread doesn't move it. Subthreads, hidden helper threads and archived threads have no
  row; a parent counts its running subthreads instead.

## A row

From left to right:

1. The agent's mark, faint unless the row has a state or is open.
2. The project's tile: its initial on a colour hashed from the project id, the
   same colour every time.
3. The title, fading out at its end when it doesn't fit.
4. A pill with how many threads run under it (its own background agents plus
   every running subthread), when any do.
5. The corner, which holds exactly one of:
   - a state glyph: a dashed ring for working, connecting (blue) or waiting on
     background work; a speech bubble for awaiting input; a green check for
     done (an unread finished turn); a red mark for failed;
   - otherwise how long ago the thread last moved: `now`, `5m`, `3h`, `2d`,
     `1w`.

While bb's jump modifier (⌘) is held, the corner shows the row's jump key.

The open thread's row is highlighted; when a subthread is open, its parent's
row is. A row with a state, or the open one, has a brighter, medium-weight
title.

## Using it

- Click a row to open the thread. Drag it toward the main area to open it in a
  split.
- Tab to the list, then use ↑ and ↓ to move between rows and Enter to open one.

## Switching back

bb shows the first thread list a plugin registers. To use bb's own list, open
Settings → Appearance → Sidebar and pick it; the choice is per client.
