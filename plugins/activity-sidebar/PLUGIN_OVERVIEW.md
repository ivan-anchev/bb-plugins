Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it.

## What you get

- **Pinned** at the top, only while something is pinned, in bb's pin order.
- **Activity** below it: every parent thread from every project, the one whose
  turn most recently ended first; opening or reading a thread doesn't move it.
  Subthreads and bb's hidden helper threads never get
  a row of their own.
- One line per thread: the thread's agent, its project's coloured initial, its
  title (fading out where it doesn't fit), how many threads run under it, and
  in its corner either its state (working, connecting, waiting, awaiting input,
  done, failed) or how long ago it last moved.
- The open thread's row, or its parent's when a subthread is open, is
  highlighted. Clicking a row opens the thread; dragging it out to the main
  area opens it in a split.

## How it works

The list reads bb's own live sidebar data, so it costs no extra request and
updates exactly when bb's list would. It draws only the rows on screen. The New
thread button, search, navigation and footer stay bb's. To go back to bb's list,
choose it under Settings → Appearance → Sidebar.
