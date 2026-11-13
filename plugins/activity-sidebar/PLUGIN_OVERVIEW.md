Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it and the Working,
Asleep and Archived shelves folded at its foot. A filter narrows it to one
project. Each row shows the thread's agent, its project's coloured initial, its
title, its pull request, how many threads run under it, and its state or how
long ago it last moved. Right-click a row for its menu (rename, pin, copy, sleep or wake,
archive, delete); under the pointer, its corner offers Archive. A thread put to
sleep waits on Asleep until its time, then comes back to the top. Rest on a row
for its card: its state and since when, machine, project, branch, pull request
and a tree of its subthreads to open.

## What you get

- **Pinned** at the top, only while something is pinned, in bb's pin order.
- **Activity** below it: every parent thread from every project, the one whose
  turn most recently ended first; opening or reading a thread doesn't move it.
  Subthreads and bb's hidden helper threads never get
  a row of their own.
- **Shelves** at the foot of the list: **Working** holds the threads under way
  (running, or waiting on background work), **Asleep** the threads put to
  sleep, soonest to wake first, and **Archived** holds bb's archived threads. They start folded, showing how many they hold; while bb
  has more archived threads than it has loaded, the count reads `50+`. Opened,
  Archived shows its latest 10 and loads more 25 at a time.
- Click any section's title to fold or unfold it. The filter button at the end
  of Activity's title narrows every section to one project, and the title
  then reads "Activity · project". The folds and the filter are remembered in
  this browser.
- One line per thread: the thread's agent, its project's coloured initial, its
  title (fading out where it doesn't fit), its branch's pull request (number,
  coloured open, draft, merged or closed), how many threads run under it, and
  in its corner either its state (working, connecting, waiting, awaiting input,
  pending approval, done, failed) or how long ago it last moved.
- The open thread's row, or its parent's when a subthread is open, is
  highlighted. Clicking a row opens the thread; dragging it out to the main
  area opens it in a split.
- Right-click a row (or press the Menu key or Shift+F10 on it) for its menu:
  Rename, Pin or Unpin, Copy (the bb thread link or the thread ID), Sleep (or
  Wake), Archive or Unarchive, and Delete…. As in bb's own menu, Delete always asks first,
  Archive asks only when the thread has subthreads, and archiving offers Undo.
  The menu won't archive a thread whose agent is still working until it
  stops.
- **Sleep** puts a thread away until a time: in 1 hour, in 3 hours, this
  evening, tomorrow at 9, next Monday at 9, or a moment you pick with Custom….
  It waits on Asleep, its corner saying how soon it wakes (`45m`, `3h`, `2d`).
  At its time it comes back to the top of Activity with a yellow alarm glyph,
  which opening the thread clears. It wakes early, for good, when it asks you
  something or fails, and Wake brings it back at once. Pinned and archived
  threads don't sleep. Sleep times are kept by the plugin's server, so every
  client shows the same; bb itself and its CLI know nothing of them.
- Rest the pointer on a row (or move keyboard focus to it) and, after a
  moment, its card opens beside it: the full title, its state and since when
  ("Working · for 4m", "Asleep · wakes at 9:00 AM", "Completed · 5m ago"), the
  machine, project and branch it runs on ("· worktree off main"), its pull
  request, and its subthreads as a small tree, busy ones first. Click a
  subthread to open it, or "Show all" to open the thread. Once a card is open,
  moving to another row swaps it at once, and the pointer can cross other rows
  on its way to the card. From a focused row, Tab reaches its subthreads and
  Escape comes back. Escape, a click, a right-click or a scroll puts it away.
  There is no card on a phone-width screen.
- Under the pointer, a row's corner becomes an Archive button (Unarchive on the
  Archived shelf). As in Zeron, it works even while the agent does, and bb
  stops the agent. Double-click a row to rename it in place.

## How it works

The list reads bb's own live sidebar data, so it costs no extra request and
updates exactly when bb's list would. Pull requests come from bb's GitHub PR
Status plugin, one batched read for the rows on screen; a thread waiting for
you is asked what it waits on (an approval or an answer) while its row is on
screen. Sleep times are one small read from the
plugin's own database, refreshed on every client when one changes. It draws only the rows on screen. The New
thread button, search, navigation and footer stay bb's. To go back to bb's list,
choose it under Settings → Appearance → Sidebar.
