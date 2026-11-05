---
name: file-tree
description: What the File Tree plugin's "Files" side-panel tab shows (the environment's files and its git changes as a tree with colored file-type icons, with the clicked file's contents or diff shown beside the tree) and how to point a user at it.
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

Clicking a file shows it inside the same tab, beside the tree when the panel is
wide and below it when the panel is narrow; no new tab opens. In **All files**
the viewer shows the file's contents with bb's source viewer. In **Changes** it
shows the file's diff for the selected scope with bb's diff viewer, including
added, deleted, untracked and renamed files. Binary files, text files over
1 MB, and diffs git reports as too large show a short note instead. The file
being shown stays highlighted in the tree; clicking another file replaces it.
Each view remembers its own selection, and the viewer goes back to "Select a
file" when the selected file is no longer in the tree (for example after
switching from **Branch vs <base>** to **Uncommitted**). The refresh button and
reopening the tab both reload the tree and the shown file. Environments that are not git repositories show a short
note in the Changes view instead of a tree.

## Pointing a user at it

Tell the user to open the side panel and select the **Files** tab. The plugin
cannot be driven from the CLI; to show a specific file, open it with
`bb thread open <thread-id> <path>` instead.
