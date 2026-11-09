# Context: pr-reviews line selection and GitHub comments

Full reports: `research/map.md` (codebase map, file:line) and `research/prior-art.md` (reviewdog, vscode-pull-request-github, octo.nvim; GitHub REST docs). This file lists the facts that matter most.

## Diff rendering
- `experimental_Diff` (SDK 0.6.104 pin; also 0.6.132/0.6.133) has only patch/path/view/overflow/showLineNumbers/experimental_fullFileContents/className. No selection, line callbacks or annotations. The host's own line selection offers "Add to chat" only inside thread views (map.md §1).
- bb shares `@pierre/diffs` and `@pierre/diffs/react` with plugins as host modules (`pierreDiffs`, `pierreDiffsReact`), as it shares react and radix. Seen in `~/.bb-machines/ivananchev.getbb.app/npm/lib/node_modules/bb-app/host-daemon/dist/bb-chunks/plugin-K4RLPVUQ.js:2599`. The exports include `PatchDiff`, `FileDiff`, `MultiFileDiff`, `File`, `GutterUtilitySlotStyles`, `Virtualizer`. The host diff renders into Pierre's `diffs-container` element with an open shadow root (`plugins/pr-reviews/src/app/guide/continuation-diff.tsx`). The web bundle (and so the exact @pierre/diffs version bb ships) is not on this remote machine; a local `bb-app@0.49.0` install will have it. npm latest @pierre/diffs is 1.6.4 (Apache-2.0).
- `experimental_useCodeTheme()` exists in the pinned SDK 0.6.104. It gives the active code theme as a VS Code theme file "for a plugin that renders code with an engine of its own".
- Host-shared modules are devDependencies in this repo (e.g. `@radix-ui/react-popover` in pr-reviews devDependencies).
- Changes tab: `src/app/changes/diff-viewer.tsx` (one `<Diff>` per file, with `experimental_fullFileContents` for expanding unchanged lines). Guide steps: `src/app/guide/hunk-block.tsx` splits a hunk into several `<Diff>` slices and draws `FindingBlock` between them (`src/guide/finding-segments.ts`). The comment there says it becomes one `<Diff>` once line annotations exist.

## GitHub
- Only `src/github/gh.ts` runs gh, via `runHostCommand` (`src/github/host-command.ts`; args only, no stdin; 60 s timeout; env disables prompts and pagers). `refusalFor` maps failures to `experimental_PluginRpcRefusal`. Nothing writes to GitHub today.
- POST /repos/{o}/{r}/pulls/{n}/comments: body, commit_id, path, line, side (LEFT|RIGHT), start_line, start_side, subject_type (line|file). It returns 201 with `html_url`, or 422 on a validation failure. POST /repos/{o}/{r}/issues/{n}/comments: body.
- Prior art rule: a range is commentable only when every line is in the same hunk. LEFT is valid only for deleted lines; RIGHT covers added and context lines. Omit start_* for a single line. Fall back to `subject_type=file`.

## Data available
- `DiffFile`/`Hunk`/`numberedLines` in `src/diff/diff-schema.ts` (old/new number per line). `parsePrDiff`. Changes RPC returns `{headSha, files}`; the guide RPC returns `{record, files}` pinned at the guide head (`store.snapshotFiles`).
- Finding: `{file, line, side: new|old, hunk, priority, title, body}`, a single line (`src/guide/guide-schema.ts`).
- Ask flow: finding-block.tsx → `useAskAboutFinding` (queries.ts) → contract `askAboutFinding` → rpc-handlers → `reviews.ask` → `bb.sdk.threads.send(..., mode "queue-if-active")` with `askMessage` (prompt.ts). It needs a stored guide. Review chat opens with `experimental_useAppPanel().openTab({tab: REVIEW_CHAT_TAB})` (review-chat-button.tsx).

## Checks
- `npm run check` (root): manifests, typecheck, and tests pass (pr-reviews 353 tests). `bb plugin build` fails on this machine for every plugin (toolchain download error: `Cannot find module 'npm/package.json'`). That is an environment problem, present on main.
- The checkout has no node_modules. Run `npm ci` at the repo root first.
- Live testing: `docs/remote-live-testing.md` (throwaway bb server on :48886, `local_bb` wrapper, headless browser via `bb browser-automation open --backend local --headless`).

## Docs claiming read-only (all need updating)
package.json:29 bb.description (+ regenerated marketplace.json), PLUGIN_OVERVIEW.md:4 and :61-64, src/app/page/review-screens.tsx:28, skills/pr-reviews/SKILL.md:71, :215, :333-336.
