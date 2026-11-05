# bb-plugin-file-tree

A **Files** tab in the thread side panel that shows the environment's files,
and its git changes, as a tree with colored per-file-type icons. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/file-tree/SKILL.md` for what the tab shows.

## Layout

| Path | What it is |
| --- | --- |
| `app.tsx` | Registers the fixed `files` tab in thread context. |
| `app.css` | Maps the tree's theme variables to bb's host tokens. |
| `server.ts` | Minimal backend entry; bb requires one. |
| `src/files-tab.tsx` | The tab: no-environment notice and the All files / Changes switch. |
| `src/all-files-view.tsx` | All files: `useSdk().environments.paths`, rendered as a tree. |
| `src/changes-view.tsx` | Changes: the `bb--git` `files` and `status` reads, scope switch, status letters. |
| `src/git.ts` | The slice of the `bb--git` RPC contract this plugin reads. |
| `src/tree-input.ts` | Pure mapping from bb data to `@pierre/trees` input: paths, git status, icons, and distinct tree paths for a changed file that stands where a changed directory is. Unit tested. |
| `src/tree-view.tsx` | The `@pierre/trees` tree: density, path sync, click to open. |
| `src/hooks/` | React hooks: environment paths, opening a file preview, refetch on show, per-environment remembered state. |
| `src/chrome.tsx` | Toolbar, segmented control, and notices in bb token classes. |

The tree and its icons are [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees)
(Apache-2.0) with its built-in `complete` colored icon set, the same component
T3 Code uses.

## Develop

From the repository root:

```sh
npm install
npm run check
bb plugin install ./plugins/file-tree
bb plugin dev plugins/file-tree
```

`npm test` in this directory runs the unit tests with `node --test`.
