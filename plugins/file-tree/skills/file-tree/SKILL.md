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
  Each file shows its line counts (`+12 -3`, or `Binary`) and a status letter:
  `A` added, `M` modified, `D` deleted, `R` renamed, `U` untracked. Counts and
  letters use bb's own diff colors. A dot marks folders that contain changes.
  The header above the tree works like bb's Diff tab header:
  - **Target dropdown**: **All changes** (everything since the merge-base
    branch), **Committed changes** (only the branch's commits), **Uncommitted
    changes** (the working tree against `HEAD`), and each of the branch's
    commits. Options with nothing in them are not offered.
  - **Stats**: `N files, +A -D`, or `N of M files · +A -D` while a filter is
    on. The file count follows the filters; the `+A -D` lines always cover
    the whole change, whatever the search and filters hide. Hovering the
    stats, or focusing them with Tab, opens the breakdown of those lines:
    `+A -D` for each change kind that has lines, then the total. When the
    change list was cut short, the lines cover the loaded files only: the
    header says `shown` and the total is labelled **Shown slice**. Escape or
    moving away closes it.
  - **Search** (magnifier): filters the tree by path. Plain text matches
    anywhere in the path; globs such as `*.md` or `docs/**` work, terms are
    separated by commas, and `!` excludes (`*.ts, !*.test.ts`). Escape closes it.
  - **Filter** (funnel): hide change kinds, keep only some file extensions,
    hide deleted files, or reset every filter. **Hide tests** hides tests and
    mocks together and is checked while both are hidden; under **Kinds** each
    kind present has its file count, and unchecking one hides its files.
  - **Collapse / expand all folders**.
  - **Diff settings** (gear): **Unified** or **Split** diff, **Wrap lines**,
    and **Hide whitespace**, which also recounts the lines.

Every changed file has one **change kind**, decided by its path alone (a
renamed file by its new path), checked in this order:

1. **Generated**: lockfiles (`package-lock.json`, `pnpm-lock.yaml`,
   `Cargo.lock`, `go.sum`, …), `.gen.` and `.generated.` files, minified
   files and source maps, protobuf output, and anything under `generated`,
   `_generated` or `__generated__`.
2. **Mocks**: snapshots (`.snap`), `.mock.`, `.fixture.`, `.stub.` and
   `.fake.` files, names that are or start with a word such as `mock` or
   `fixtures` (`mockServer.ts`, `fixtures.json`), and anything under
   `__mocks__`, `__fixtures__`, `__snapshots__`, `fixtures`, `mocks`,
   `stubs`, `fakes` or `testdata`.
3. **Tests**: `.test.`, `.spec.`, `.e2e.` and `.eval.` files, `_test` and
   `_spec` files, `test_*.py`, `conftest.py`, test classes such as
   `FooTest.java` (but not `Latest.java`), and anything under `test`,
   `tests`, `__tests__`, `spec`, `specs`, `e2e`, `cypress` or `evals`.
4. **Docs**: `.md`, `.mdx`, `.markdown`, `.rst`, `.adoc` and `.txt` files,
   except tool inputs such as `requirements.txt` or `CMakeLists.txt`.
5. **Code**: everything else.

Clicking a file shows it inside the same tab, beside the tree when the panel is
wide and below it when the panel is narrow; no new tab opens. Drag the line
between the tree and the viewer to resize them, or focus it and use the arrow
keys (Home and End jump to either limit); the size is kept while bb stays open. In **All files**
the viewer shows the file's contents with bb's source viewer. In **Changes** it
shows the file's diff for the selected scope with bb's diff viewer, including
added, deleted, untracked and renamed files. Binary files, text files over
1 MB, and diffs git reports as too large show a short note instead. The file
being shown stays highlighted in the tree; clicking another file replaces it.
Each view remembers its own selection, and the viewer goes back to "Select a
file" when the selected file is no longer in the tree (for example after
switching from **All changes** to **Uncommitted changes**, or when a filter hides
it). The refresh button and
reopening the tab both reload the tree and the shown file. Environments that are not git repositories show a short
note in the Changes view instead of a tree.

## Pointing a user at it

Tell the user to open the side panel and select the **Files** tab. The plugin
cannot be driven from the CLI; to show a specific file, open it with
`bb thread open <thread-id> <path>` instead.
