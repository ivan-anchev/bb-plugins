---
name: file-tree
description: What the File Tree plugin's "Files" side-panel tab shows (the environment's files and its git changes as a tree with colored file-type icons) and how to point a user at it.
---

# File Tree

The File Tree plugin adds a **Files** tab to the side panel of every thread that
has an environment. It has no CLI command, no agent tool, and no settings.

## What the tab shows

- **All files**: every file and folder in the thread's environment, as a
  collapsible tree. Folders come first, then files, both alphabetical. Folders
  with a single child are shown as one row (`.github/workflows`). Each file has
  a colored icon for its type (TypeScript, React, JSON, Markdown, CSS, git,
  npm, images, and many more). Files that `.gitignore` excludes are not listed.
  Very large environments are capped at 20,000 paths, with a note at the
  bottom when the list is cut short.
- **Changes**: the same tree, limited to the files git reports as changed.
  Each file carries a status letter: `A` added, `M` modified, `D` deleted,
  `R` renamed, `U` untracked. A dot marks folders that contain changes.
  - **Uncommitted** compares the working tree with `HEAD`.
  - **Branch vs <base>** appears when the environment has a merge-base branch
    and shows every change since that branch, committed or not.

Clicking a file opens it in bb's file preview. A deleted file opens read-only
at the revision it was deleted from. The refresh button and reopening the tab
both reload the tree. Environments that are not git repositories show a short
note in the Changes view instead of a tree.

## Pointing a user at it

Tell the user to open the side panel and select the **Files** tab. The plugin
cannot be driven from the CLI; to show a specific file, open it with
`bb thread open <thread-id> <path>` instead.
