# Code Explorer

A **Files** tab in the thread side panel that shows the environment's files,
and its git changes, as a tree with colored per-file-type icons. Clicking a file
shows its contents, or its diff in Changes, beside the tree in the same tab. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/code-explorer/SKILL.md` for what the tab shows.

## Install

```sh
bb marketplace add git:github.com/ivan-anchev/bb-plugins@main
bb plugin install code-explorer@ivan-anchev
```

If you have the old File Tree plugin installed, remove it with
`bb plugin remove file-tree` to avoid a second Files tab.

## Screenshots

Browse changed files and read their diffs beside the tree.

![Changes tree with the selected file diff](screenshots/changes.png)

Hover or focus the totals to see added and deleted lines by change kind.

![Diff buckets showing line counts for code, generated files and docs](screenshots/diff-buckets.png)

Filter by change kind or file type, or hide tests and mocks together.

![Filter menu with change kinds and file types](screenshots/filters.png)

## Credits

The tree and its icons are [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees)
(Apache-2.0) with its built-in `complete` colored icon set, the same component
T3 Code uses. The path filter matches with [`picomatch`](https://www.npmjs.com/package/picomatch)
(MIT), as bb's Diff tab does. The change kind rules in `src/changes/change-kind.ts`
are ported from [T3 Code](https://github.com/pingdotgg/t3code)'s
`packages/shared/src/changedFileKind.ts` (MIT, © 2026 T3 Tools Inc.), as is
the layout of the kind breakdown.

## Develop

From the repository root:

```sh
npm install
npm run check
bb plugin install ./plugins/code-explorer
bb plugin dev plugins/code-explorer
```

`npm test` in this directory runs the unit tests with `node --test`.
