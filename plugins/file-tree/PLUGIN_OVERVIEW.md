A **Files** tab in the side panel of every thread, showing the thread's
environment the way T3 Code and the Codex app do: a compact tree with a colored
icon for each file type.

## What you get

- **All files**: the whole environment as a collapsible tree, folders first,
  single-child folders collapsed into one row, and gitignored files left out.
- **Changes**: the same tree limited to what git reports as changed, with
  `+A -D` line counts and an `A`, `M`, `D`, `R` or `U` status on each file, in
  bb's diff colors, and a dot on folders that contain changes. The header works
  like bb's Diff tab: pick all changes, committed, uncommitted, or a single
  commit; read the `N files, +A -D` total; search by path or glob; filter by
  file type; collapse every folder; and switch the diff between split and
  unified, wrapped lines, and hidden whitespace.
- **See what kind of change it is**: every changed file is sorted by its path
  into code, tests, mocks (fixtures, snapshots and other test support),
  generated files (lockfiles and build output) or docs. Hover or focus the
  total to see its `+A -D` per kind, and use the filter menu to hide kinds,
  or every test and mock at once with **Hide tests**.
- **Read it in place**: click a file and it shows beside the tree, in the same
  tab. In All files you see its contents; in Changes you see its diff, both
  drawn by bb's own code and diff viewers. Nothing opens a new tab, and the
  file you are reading stays highlighted in the tree. Drag the divider, or
  use the arrow keys on it, to give the tree or the viewer more room.
- **Follows your theme**: the tree uses bb's own colors in light and dark mode.

## How it works

The file list comes from bb's environment path search and git changes come from
bb's built-in Git plugin, so the tree works for local and remote environments
alike. Icons ship inside the plugin, and nothing is sent anywhere. The tree
and the open file reload when you reopen the tab or press refresh. The tree sits
beside the viewer when the panel is wide, and above it when the panel is narrow.

The tab is read-only: it never edits, creates, renames or deletes files.
