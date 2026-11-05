# bb-plugin-file-tree

A **Files** tab in the thread side panel that shows the environment's files,
and its git changes, as a tree with colored per-file-type icons. Clicking a file
shows its contents, or its diff in Changes, beside the tree in the same tab. See
`PLUGIN_OVERVIEW.md` for the user-facing description and
`skills/file-tree/SKILL.md` for what the tab shows.

## Layout

| Path | What it is |
| --- | --- |
| `app.tsx` | Registers the fixed `files` tab in thread context. |
| `app.css` | Maps the tree's theme variables to bb's host tokens. |
| `server.ts` | Minimal backend entry; bb requires one. |
| `src/files-tab.tsx` | The tab: no-environment notice and the All files / Changes switch. |
| `src/all-files-view.tsx` | All files: `useSdk().environments.paths` as a tree, with the selected file's contents beside it. |
| `src/changes-view.tsx` | Changes: the `bb--git` `files` and `status` reads, scope switch, status letters, with the selected file's diff beside the tree. |
| `src/file-viewer.tsx` | A file's contents in bb's `experimental_SourceCode`, read with `useSdk().files.read`. |
| `src/diff-viewer.tsx` | A changed file's diff in bb's `experimental_Diff`, from `files` `initialPatches` or the keyed `patches` read. |
| `src/git.ts` | The slice of the `bb--git` RPC contract this plugin reads. |
| `src/viewer-input.ts` | Pure choice of what the viewer shows: a patch, a patch key to fetch, source text, or a notice. Unit tested. |
| `src/tree-input.ts` | Pure mapping from bb data to `@pierre/trees` input: paths, git status, icons, and distinct tree paths for a changed file that stands where a changed directory is. Unit tested. |
| `src/tree-view.tsx` | The `@pierre/trees` tree: density, path sync, the selected row, click to select. |
| `src/hooks/` | React hooks: environment paths, file contents, refetch on show, per-environment remembered state. |
| `src/chrome.tsx` | Toolbar, segmented control, notices, and the tree-beside-viewer layout in bb token classes. |

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
