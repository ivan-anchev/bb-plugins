A **Files** tab in the side panel of every thread, showing the thread's
environment the way T3 Code and the Codex app do: a compact tree with a colored
icon for each file type.

## What you get

- **All files**: the whole environment as a collapsible tree, folders first,
  single-child folders collapsed into one row, and gitignored files left out.
- **Changes**: the same tree limited to what git reports as changed, with an
  `A`, `M`, `D`, `R` or `U` status on each file and a dot on folders that
  contain changes. Compare uncommitted work with `HEAD`, or everything on the
  branch with its merge base.
- **One click to open**: any file opens in bb's file preview. A deleted file
  opens read-only at the revision it was deleted from.
- **Follows your theme**: the tree uses bb's own colors in light and dark mode.

## How it works

The file list comes from bb's environment path search and git changes come from
bb's built-in Git plugin, so the tree works for local and remote environments
alike. Icons ship inside the plugin, and nothing is sent anywhere. The tree
reloads when you reopen the tab or press refresh.

The tree is read-only: it never creates, renames or deletes files.
