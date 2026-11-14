Replaces bb's thread list with one Activity list of every parent thread from
every project, latest first, with pinned threads above it and the Working and
Archived shelves folded at its foot. A filter narrows it to one project.

## What you get

- **Pinned** at the top, only while something is pinned, in bb's pin order.
- **Activity** below it: every parent thread from every project, the one whose
  turn most recently ended first; opening or reading a thread doesn't move it.
  Subthreads and bb's hidden helper threads never get
  a row of their own.
- **Shelves** at the foot of the list: **Working** holds the threads under way
  (running, or waiting on background work), and **Archived** holds bb's
  archived threads. They start folded, showing how many they hold; while bb
  has more archived threads than it has loaded, the count reads `50+`. Opened,
  Archived shows its latest 10 and loads more 25 at a time.
- Click any section's title to fold or unfold it. The filter button at the end
  of Activity's title narrows every section to one project, and the title
  then reads "Activity · project". The folds and the filter are remembered in
  this browser.
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
