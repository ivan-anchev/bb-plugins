---
name: activity-sidebar
description: Explain the Activity Sidebar plugin, which replaces bb's thread list with one Activity list of every parent thread from every project, latest first, with pinned threads above it, the Working and Archived shelves folded at its foot and a project filter, each row showing the thread's agent, project initial, title, running subthreads and its state or age. Use when the user asks what the Activity list shows, why a thread is or isn't in it, what a row's corner glyph means, what the shelves and the filter do, or how to switch back to bb's own list.
---

# Activity Sidebar

The Activity Sidebar plugin replaces the scrolling thread list in bb's sidebar.
The New thread button, search, navigation and footer stay bb's. It has no
commands and no settings.

## What the list shows

- **Pinned**, only while a thread is pinned, in bb's own pin order.
- **Activity**: every parent thread from every project that isn't under way,
  the one that most recently came back first: its turn ended or failed.
  Opening or reading a thread doesn't move it. Subthreads and hidden helper
  threads have no row; a parent counts its running subthreads instead.
- Below a gap that fills the rest of the sidebar, the **shelves**:
  - **Working**: unpinned threads under way (running, connecting, or waiting
    on background work that will wake them). When a turn starts, the thread
    leaves Activity for Working; when it ends, it returns to the top of
    Activity.
  - **Archived**: bb's archived parent threads, latest archived first, each
    showing how long ago it was archived.

  An empty shelf is left out. When the list is longer than the sidebar, the
  shelves follow Activity and you scroll down to them.

## Folding and the project filter

- Click a section's title to fold or unfold it. Pinned and Activity start
  open; the shelves start folded. A folded title shows how many threads it
  holds. Archived reads `n+` while bb has more archived threads than it has
  loaded, since bb has no archived total.
- Opened, Archived shows its latest 10 and a "Show 25 more" row. Past what is
  loaded, it reads "Show more" and loads the next page. If a page fails to
  load, the shelf says "Couldn't load archived threads · Retry".
- The filter button at the end of Activity's title narrows Pinned, Activity
  and every shelf to one project; the title then reads "Activity · project".
  Choose "All projects" to show everything again.
- The folds and the filter are kept in this browser's local storage, so they
  survive a reload but aren't shared with other clients.

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
- Tab to the list, then use ↑ and ↓ to move between rows and section titles.
  Enter opens a row or folds a title. The filter button is the next Tab stop.

## Switching back

bb shows the first thread list a plugin registers. To use bb's own list, open
Settings → Appearance → Sidebar and pick it; the choice is per client.
