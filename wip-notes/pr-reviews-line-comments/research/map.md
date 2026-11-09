# Map: pr-reviews line selection and PR comments

Paths are relative to the repo root (`checkouts/project-proj-uta6n4q3v8`). `P` = `plugins/pr-reviews`.
SDK source read from a scratch `npm ci` copy (`/tmp/prr-copy/node_modules/@get-bb/plugin-sdk`, v0.6.104, the plugin's pin). The repo has no `node_modules`, and I did not touch the checkout.

## 1. experimental_Diff and the SDK

### Every prop `DiffProps` accepts
`node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts:19334-19360` (`interface DiffProps`).
Seven props, and nothing else:
- `patch: string`. Unified patch for ONE file; a headerless patch is completed from `path`.
- `path: string`.
- `view?: "split" | "unified"` (default unified; `DiffViewMode` at :19285).
- `overflow?: "scroll" | "wrap"` (`CodeOverflowMode`, :19283).
- `showLineNumbers?: boolean`.
- `experimental_fullFileContents?: { old: {path, content}, new: {path, content} }` (:19292-19301). It enables expand-context controls between hunks.
- `className?: string`.

There is NO prop for line click/gutter callback, line annotations, render-under-line slot, selected-range state or highlight, or hover utility. There is no `onLineSelect`, `selectedLines` or `annotations`.
- `SourceCodeProps` (:19310-19324), the file viewer, is likewise: `highlightedLines?: {start,end}` highlights lines, one-way only. It has no selection callback.

### The host owns selection and "Add to chat"
The doc comment on `DiffProps` (:19326-19333) says the host owns "gutters, line-selection presentation". It adds: "Inside a thread view, selected lines offer Add to chat, which quotes them into that thread's composer." The same sentence is on `SourceCodeProps` (:19305-19309).
- So the host already has line selection, but only wired to a thread view's composer. No selection state, event or range is exposed to the plugin.
- Whether it works on a plugin nav-panel page (as here) is not documented. The app panel is not a "thread view", but the Review chat tab does embed `ThreadChat` (`P/src/app/review-chat/review-chat-tab.tsx:66`).
- No behaviour was observed live; I did not run bb's UI.

### Renderer replacement (the only other lever in the types)
- `experimental_diffRenderer(registration)` (`...d.ts:22132-22136`, `PluginDiffRendererRegistration` :21037-21050). It replaces bb's diff renderer everywhere and is exclusive, so it affects every other plugin and the timeline.
- `PluginDiffRendererProps` (:19376-19400) receives `patch, path, view, overflow, showLineNumbers, experimental_fullFileContents, Original`. It receives no selection or annotation props either.

### Host DOM
- Nothing about the diff's DOM is documented in the SDK: grep for `data-line`, `data-side`, `data-diff` and `data-gutter` in `dist/` and `bundled-types/` finds nothing relevant.
- The only host DOM knowledge in this repo is the undocumented, self-described fragile hack in `P/src/app/guide/continuation-diff.tsx:6-27`. The host draws into a `diffs-container` custom element with an OPEN shadow root (`:22`, `element.querySelectorAll("diffs-container").forEach(c => ... c.shadowRoot)`). Page CSS cannot cross it. The plugin injects a rule for `[data-separator][data-separator-first]` (`:13`) and re-applies it with a `MutationObserver` (`:24-25`) because bb loads the diff lazily. The file comment says "If bb renames the element or the separator's attributes, nothing matches".
- The bb app's own source for the diff component is not on disk (searched `~/.bb-machines/.../npm/lib/node_modules/bb-app`). Only a bundled name list at `host-daemon/dist/bb-chunks/plugin-K4RLPVUQ.js:2599` mentions `experimental_Diff`. `grep "Add to chat"` finds nothing in any bb JS on disk.
- Gutter/line DOM attributes (line number, side) are therefore NOT verifiable from anything on disk.

### How the guide places a finding under its line today
It splits the hunk into separate `<Diff>` blocks and draws the finding card between them.
- `P/src/app/guide/hunk-block.tsx:42-52` (`AnnotatedDiff`). With no findings it is one `HunkDiff`. Otherwise `interleaveFindings(hunkOf(file, hunk), findings)` yields segments. A `finding` segment renders `<FindingBlock key="finding N">`, and a `code` segment renders `Diff` for the first and `ContinuationDiff` for later ones, with `hunkToPatch(segment.hunk)`.
- The comment at `hunk-block.tsx:38-41` says: "When experimental_Diff takes line annotations, this becomes one <Diff>". That is the author's stated future seam. It does not exist in the SDK at 0.6.104.
- `P/src/guide/finding-segments.ts:11-22`: `interleaveFindings` cuts the hunk after each finding's line. It uses `numberedLines` + `cutAfter` (`P/src/diff/hunk-patch.ts:143-150`), which cuts after the whole `-`/`+` run for a removed line. `sliceHunk` (`hunk-patch.ts:122-135`) rewrites the header for each slice. Findings on one line keep their order (`:26-28`).
- Consequence: a guide step's diff is several independent `<Diff>` instances per hunk, each with a rewritten `@@` header. Any host selection in them would be relative to a slice, and the host's own line numbers would come from the sliced header.
- `HunkDiff` (`hunk-block.tsx:34-37`) is a plain `Diff` on `hunkToPatch(hunk)`. `ContinuationDiff` is at `continuation-diff.tsx:16-35`.

### Where the Changes tab renders it
- `P/src/app/changes/diff-viewer.tsx:62-71`: `<Diff patch path view overflow experimental_fullFileContents/>`. The patch is `filePatchOf(file)` via `diffSourceOf` (`P/src/diff/hunk-patch.ts:112-115`, `P/src/app/changes/diff-source.ts`). `DiffViewer` already receives `projectId` and `headSha` (`diff-viewer.tsx:13`, passed from `changes-panel.tsx:75` as `changes.headSha`). It does not receive the PR number.
- `DiffPane` is the scroll region and tab stop (`diff-viewer.tsx:84-96`).

### Prior use of line selection in this repo
- None. `plugins/code-explorer/src/diff-viewer.tsx` and `file-viewer.tsx` use `experimental_Diff` / `experimental_SourceCode` the same way, as plain render with no selection, per grep on `line|select|gutter` and `experimental_Diff|experimental_SourceCode`. Nothing in the bb app's code-explorer on disk beyond `plugins/code-explorer`, which is this repo's copy.
- Other users of `experimental_Diff`: `plugins/subagents-strip/ui/TranscriptTab.tsx` (render only).

## 2. GitHub access

### How gh runs
- `P/src/github/host-command.ts:7-18`. `runHostCommand("gh"|"git", args)` goes through `experimental_execHostFile` (login-shell PATH) with env `GH_PROMPT_DISABLED=1, GH_PAGER=cat, GIT_TERMINAL_PROMPT=0, NO_COLOR=1, LC_ALL=C`, `maxBuffer` 64 MB, `timeout` 60 s. There is no stdin support: args only. Failures parse to `{code, stderr}` (`:23-26`).
- `P/src/github/gh.ts:121-126` `runGh` wraps it and maps failures with `refusalFor` (`:128-141`). The `Refusal` is `experimental_PluginRpcRefusal` (import at `:3`):
  - ENOENT → `invalid` "needs the GitHub CLI…"
  - stderr contains `gh auth login` → `forbidden` "isn't signed in"
  - stderr contains `Could not resolve to a PullRequest` → `not_found`
  - else `invalid` with the first stderr line (`firstLine`, `host-command.ts:28`) or "The GitHub CLI failed."
- `gh.ts` is the only module that runs `gh` (header comment `:1-2`); `git` is run in `P/src/github/pr-commits.ts`, `project-repo.ts`.

### Does anything write to GitHub?
No. gh calls found: `pr list` (`gh.ts:64`), `pr view` (`:69`, `:107`), `pr diff` (`:84`), and `api repos/.../contents/...?ref=` (GET, `:97`). Writes are limited to `git fetch` of PR refs into `refs/pr-reviews/` (SKILL.md:333-336). The review thread is told not to run gh (`P/src/server/prompt.ts:53`).
- `gh api` is already used, so adding a POST would be a new verb, not a new binary. Nothing today passes `--method`/`-f`/`--input`, and `runHostCommand` has no stdin path.

### headSha and the pinned diff server-side
- `snapshotPrDiff(repo, number)` (`gh.ts:80-91`) returns `{headSha, baseSha, diff}`. It reads head/base before and after `gh pr diff` and retries once, then throws a `conflict` Refusal "being pushed to right now" (`:90`). `commitsOf` (`:106-110`) is `gh pr view --json headRefOid,baseRefOid`.
- The `changes` RPC is `changesOf(await snapshotPrDiff(await repoOf(projectId), number))` (`P/src/server/rpc-handlers.ts:82-84`, `:119-125`). It returns `{headSha, files: parsePrDiff(diff)}`, and a parse failure becomes an `invalid` Refusal.
- `fileContent` RPC (`rpc-handlers.ts:86-88`, `gh.ts:96-104`) gives text at a sha.
- `viewPr` (`gh.ts:68-71`) gives `PrDetail` with `headSha` (`headRefOid`, `:23`), `url` (`:39`), `state` (`:56`).
- Stored pins: SQLite `diff_snapshots(repo, number, head_sha, diff, taken_at)` and `guides` (`P/src/server/store.ts:20-33`). `snapshotFiles(key)` (`:382-385`) re-parses the stored diff, and the `guide` RPC returns `{record, files: store.snapshotFiles(key)}` (`rpc-handlers.ts:75-80`). The snapshot exists only for heads that had a review run (`saveRun`, `store.ts:354-361`).
- For a PR with no run, the only diff source is a live `snapshotPrDiff`. The Changes tab shows the live diff at the head it was fetched at, so it can be ahead of the stored guide snapshot.
- `ReviewState` / guide head: `guideHeadShaOf` (`P/src/contract.ts:109-122`); `commitsSince(pr, guideHeadSha)` (`:89-92`).

### Parsing into hunks with line numbers
- `parsePrDiff(text)` (`P/src/diff/parse-pr-diff.ts:166-168`) → `DiffFile[]`: `{path, previousPath, status, binary, hunks}` (`P/src/diff/diff-schema.ts:16-26`). `Hunk` = `{oldStart, oldLines, newStart, newLines, lines[]}` with raw prefixed lines (`:5-13`). It uses jsdiff and undoes jsdiff's +1 on empty sides (`parse-pr-diff.ts:246-256`).
- Line numbering helpers in `diff-schema.ts`:
  - `numberedLines(hunk)` (`:61-75`) → `{text, old|null, new|null}` per line; the `\ No newline` marker is on neither side.
  - `firstLinesOf` (`:81-85`).
  - `fileOf` (`:91-95`) and `hunkOf` (`:98-102`) throw on a miss.
- Can the server tell whether a new-side line range is inside a hunk from existing helpers? There is no function for ranges. But:
  - `numberedLines(hunk).some(l => l[side] === n)` is exactly how finding validation tests a single line (`P/src/guide/validate-submission.ts:105-106`).
  - `rangesOf(file, side)` (`validate-submission.ts:150-157`) builds "first-last" strings per hunk for error text.
  - Nothing tests that a start AND end line are in the SAME hunk, nor "added vs context" lines. Nothing computes GitHub's `position`.
- Renames: `DiffFile.path` is the NEW path, and `previousPath` is the old (`diff-schema.ts:17-20`). A deleted file's `path` is the old path (`:18`).

## 3. Review thread and "Ask about this"

### Flow
1. UI: `P/src/app/guide/finding-block.tsx:120-205` (`AskAboutThis`). A toggle opens a textarea, and "Send" calls `ask.mutate({...target, findingIndex: shown.index, question})` (`:138-148`). On success it shows "Sent to the review thread. Its answer is in Review chat." (`:167-169`) and clears or closes. Errors show `ask.error.message` (`:187-191`). Primitives used: `Button` (`:192-199`), `Prose`, the `DESTRUCTIVE_TEXT_ON_MUTED` class.
2. Hook: `P/src/app/queries.ts:457` `useAskAboutFinding = () => experimental_useRpcMutation({ contract, method: "askAboutFinding" })`. `target` is `GuideTarget = PrTarget & {headSha}` (`queries.ts:432-435`).
3. Contract: `P/src/contract.ts:203-206`. Input is `prRef + {headSha, findingIndex (int >= 0), question (trim, min 1)}`; output is empty.
4. Handler: `P/src/server/rpc-handlers.ts:110-113` → `reviews.ask({repo, number, headSha}, findingIndex, question)`.
5. `P/src/server/reviews.ts:305-310` `ask`: loads `store.guide(key)`, picks `guide.findings[findingIndex]`, and refuses `not_found` "That finding is no longer in the guide." if either is missing. It then calls `send(record.threadId, askMessage(finding, question))`.
6. `send` (`reviews.ts:187-188`) = `bb.sdk.threads.send({threadId, input:[{type:"text", text, mentions:[]}], mode:"queue-if-active"})`. The message is queued behind a running turn and never interrupts it.
7. Message text: `P/src/server/prompt.ts:40-46`. It quotes `finding.title`, `pathLiteral(file)`, `line` and `side`, then the question, then "Answer in this thread. Call submit_review again only if…".

### No thread yet / running thread
- `ask` needs a stored guide for the exact headSha, so a finding (and therefore Ask) exists only where a guide exists; its thread is `record.threadId`. It works in any PR state: comment at `reviews.ts:303-304` "Asks the thread that wrote the guide, whatever the PR's state now. The page stays 'Guide ready' while the thread answers". A running thread just queues (`queue-if-active`).
- For a general question on a PR without a guide there is NO existing server path. The `ask` path requires a finding index.
- `nudge` (`reviews.ts:296-301`) sends to `review.threadId` only when `review.kind === "no-guide"`, else a `conflict` Refusal. `ReviewState.kind: "none"` has no thread (`contract.ts:96`, `reviewThreadOf` returns null at `:125`).
- A thread may be gone: `threadIsOpen` (`review-reader.ts:173-175`, archived or deleted threads are excluded). `updateGuide` then spawns a fresh review (`reviews.ts:219`).
- What `ReviewState` the page is in: derivation at `P/src/server/review-state.ts:96-112` (ready > running > no-guide > stale > none).
- Threads are spawned `visibility: "hidden"` (`reviews.ts:146`) with `permissionMode: "auto"` (`:143`). The prompt text forbids gh (`prompt.ts:53`), so a review thread cannot post comments itself.

### How Review chat opens
- `P/src/app/review-chat/review-chat-button.tsx:22-25`: `experimental_useAppPanel().openTab({ tab: REVIEW_CHAT_TAB })`. `REVIEW_CHAT_TAB = {id:"review-chat", context:{kind:"nav-panel", panelId: PANEL_ID}, availability:"action"}` (`review-chat-tab.tsx:37`). It is registered with `useVisible` only for `route.kind === "pr"` (`:46`).
- Buttons: `ReviewChatButton` (:7-14) and `ReviewChatIconButton` (:17-20); the latter is in `pr-header.tsx` (shown when `hasReviewThread`, `pr-page.tsx:46`). `review-screens.tsx:8` imports `ReviewChatButton`.
- `ReviewChatTab` (`review-chat-tab.tsx:49-54`) reads the route (`parseRoute(subPath)`) and keys the chat by `projectId/number`. `PrReviewChat` (`:57-69`) reads `usePullRequest`, takes `reviewThreadOf(review)`, shows notices for loading or no thread ("This pull request has no review thread yet. Start review on its page."), else `<ThreadChat key={threadId} threadId variant="compact" layout="contained" permissionPolicy="editable">`.
- SDK `ThreadChatProps` (`...d.ts:22805-22837`) has `threadId, variant, layout, focusRequest, permissionPolicy, className, leadingContent, messageActions`. `focusRequest` bumps focus to the composer.
- Composer API (`useComposer()` → `PluginComposerApi`, `...d.ts:22549-22640+`): scope `{kind:"thread", threadId}` (:22334-22345), and `insert(parts, options)`, `replace(...)`, `text`, `draft`, `submit` and focus methods. "in a thread's panels, that thread's composer; elsewhere, the current route's draft" (:22549-22555). Not used anywhere in pr-reviews today (grep). The route here is a plugin page, not the thread, so which draft `useComposer()` returns from the diff panel is not documented for that case.
- Programmatic send from the app side: the server-side path is the existing `bb.sdk.threads.send` (`reviews.ts:187`).

## 4. Finding shape

`P/src/guide/guide-schema.ts`
- Wire format (agent input): `{file, line: int>0, side?: "new"|"old" (default new), priority: p0|p1|p2, title, body}` (`:309-318`). Describe text: `line` "A line inside one of the file's hunks", `side` '"old" only for a removed line; defaults to "new"' (`:312-313`).
- Stored `Finding` (`:343-353`): `{file, line, side: "new"|"old" (required), hunk: HunkId, priority, title, body}`. `hunk` is "resolved at validation" (the hunk whose range holds `line` on `side`).
- So: a SINGLE line (no range/endLine field). It is on the new side by default but can be the old side for removed lines. It is NOT always new-side. Priority enum at `:266`, side enum at `:267`.
- Validation: `P/src/guide/validate-submission.ts:101-111`. The side defaults to "new". It finds the first hunk with `numberedLines(h).some(l => l[side] === input.line)`; otherwise a `finding-outside` problem (`:58`, text `:174-176`). The stored finding is `{...input, side, hunk: hunkIdOf(hunk)}`.
- Context lines count as valid new-side targets (they have both numbers, `diff-schema.ts:65-66`).
- `walkthrough.ts`:
  - `visibleFindings` (`:401-403`) maps `guide.findings` to `{index, finding}` (the index into `guide.findings` is what the server uses to name a finding, `:397-398`) and returns none when `showFindings` is off.
  - `findingsOn` (`:406-408`) filters by `finding.file === entry.file && finding.hunk === entry.hunk` (`isOn`, `:416`).
  - `stepNumberOfFinding` (`:411-414`).
- Placement uses `lineIndexOf` (`finding-segments.ts:31-35`): `lines.findIndex(line => line[finding.side] === finding.line)`, throwing if not found.
- Path: `finding.file` is the diff file's `path` (new path; old path for deletion).

## 5. Conventions

### Repo rules (`AGENTS.md`, re-read)
- `AGENTS.md:10-26`
  - One plugin per dir.
  - `package.json` is the source of truth; `.bb/plugins.json` and `marketplace.json` are generated via `npm run manifests`, never hand-edited.
  - Every plugin installs standalone (no `workspace:`, `catalog:`, `file:`, `link:` deps; no imports across plugins or from the root).
  - Keep `bb.description` and `PLUGIN_OVERVIEW.md` in agreement, "one claim in two lengths; change both in the same commit".
  - Release by tag only (`<id>/vX.Y.Z`).
  - Document commands and settings in the plugin's `skills/`.
- `AGENTS.md:29-37`
  - Run `npm run check` before finishing.
  - Behaviour changes also need a live run. On a remote machine (checkout under `~/.bb-machines/`) follow `docs/remote-live-testing.md` against a throwaway local server, and never run `bb plugin install|dev|remove` without the `local_bb` wrapper.
  - The SDK contract is `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts`. `bb plugin types plugins/<id>` fixes pin drift.
- `REVIEW.md` exists at the repo root (not read; out of the questions).

### Every place claiming nothing is posted / read-only (these would become false)
1. `P/package.json:29`: `bb.description` ends "Nothing is ever posted to GitHub."
2. `marketplace.json:103`: generated copy of #1 (regenerate with `npm run manifests`, don't hand-edit).
3. `P/PLUGIN_OVERVIEW.md:4`: "Nothing is ever posted to GitHub."
4. `P/PLUGIN_OVERVIEW.md:61-64`: "It only reads: it never comments, approves, or changes anything on GitHub. Review threads never reach GitHub at all…"
5. `P/src/app/page/review-screens.tsx:28`: UI string "Starts a review thread in a new worktree… Nothing is posted to GitHub."
6. `P/skills/pr-reviews/SKILL.md:71`: "The panel never changes anything on GitHub." (side panel of reviewers/checks/labels; arguably still true for that panel).
7. `P/skills/pr-reviews/SKILL.md:215`: "the thread is told never to write to GitHub" (about the review thread; matches `prompt.ts:53`).
8. `P/skills/pr-reviews/SKILL.md:333-336`: "It only reads; it never writes to GitHub." Also its `description:` front-matter at `:3` lists what the plugin does and ends "where its data comes from (the GitHub CLI)".
9. `P/src/server/prompt.ts:53`: the review thread's rule "You cannot reach GitHub… Do not run gh" (about the thread; separate from the plugin's own writes).
- `P/README.md` contains no "nothing posted" claim (grep for `nothing|post|read-only`; its text is about install and gh being needed at `:10`, README marketplace line `:16`). `P/README.md` and `PLUGIN_OVERVIEW.md` list `gh` requirement ("must be installed and signed in", `PLUGIN_OVERVIEW.md:61-62`). I did not verify README content beyond the greps.
- `P/src/github/gh.ts:1-2`, "only module that runs gh", and `host-command.ts:4-6` have no read-only claim.
- Docs for runs: SKILL.md `:330-336` lists the gh commands the plugin runs (`pr list`, `pr view`, `pr diff`, `git remote get-url`, `git fetch`). A new write command would belong here.

### Test conventions
- Runner: `node --test 'src/**/*.test.ts'` (`P/package.json` `scripts.test`); `node:test` + `node:assert/strict`; `describe`/`test`. The files sit beside the code: `src/guide/walkthrough.test.ts`, `src/server/reviews.test.ts`, `src/github/gh.test.ts`, `src/diff/*.test.ts`, `src/app/**/*.test.ts` (pure logic only; there are no component tests).
- Fixtures:
  - Diff text fixtures in `P/src/diff/fixtures/*.diff` (e.g. `github-pr.diff`, `renamed.diff`, `added.diff`, `deleted.diff`, `no-newline.diff`, `binary.diff`).
  - `P/src/app/changes/diff-file.fixture.ts`.
  - `gh.test.ts` uses an inline trimmed `gh pr view --json` object (`PR_42`, `:6-…`) and tests the pure `parsePrDetail`.
- `reviews.test.ts` fakes `bb` and `github` through `createReviews` deps (`reviews.ts:174-180` `Deps` type; `Bb` type `:164-172`, narrowed to the used fields). `runHostCommand`/`gh` calls themselves are not unit-tested with a fake process (gh.test.ts only covers parsing); `snapshotPrDiff` is injected as `github.snapshotPrDiff`.
- The SDK ships `dist/testing/*` (`bb-plugin-sdk-testing*.d.ts`); I did not check whether pr-reviews uses it.

### UI primitives (`P/src/app/ui/`)
- `button.tsx:22-26`: `Button` (`variant`, `size?: default|small`; `variant` values `primary`/`ghost`/etc. per `buttonClass` `:18`) and exported `buttonClass`.
- `icon-button.tsx:17,33`: `IconButton` (`icon, label, indicator`) and `IconLink`.
- `popover.tsx:8-26`: `Popover`, `PopoverTrigger` (Radix `@radix-ui/react-popover`) and `PopoverContent({label, children})`.
- `menu.tsx`: `Menu`, `MenuTrigger`, `MenuContent`, `MenuItem`, `MenuCheckboxItem`, `MenuLabel`, `MenuSeparator`, `MenuCheck` (Radix dropdown-menu).
- `tooltip.tsx:28`: `Tooltip({content, placement, className})`.
- `notice.tsx:3`: `Notice({children, tone: "quiet"|"error"})`.
- `read-error.tsx` (RPC read errors), `prose.tsx` (markdown text), `spinner.tsx`, `avatar.tsx`, `portal-scope.ts`, `destructive-text-on-muted.ts`.
- App-wide hooks: `queries.ts` (typed `experimental_useRpcQuery` / `experimental_useRpcMutation`; `useReviewAction` `:451-455` is the pattern for a mutation with `isPending` and `error`).
- Errors from RPC mutations surface as `mutation.error.message` (used at `finding-block.tsx:189`), carrying the Refusal text.
- Contract changes: add methods to `defineRpcContract` in `P/src/contract.ts:162-207`, handlers in `rpc-handlers.ts:56-114`. `tags` on queries are used for invalidation (`PROJECTS_TAG`, `repoTag`, `guideTag`, `:158-160`). Mutations such as `askAboutFinding` have no tags.

## 6. Checks

Run in a scratch copy at `/tmp/prr-copy` (`git archive HEAD` + `npm ci`, 4.7 s), because the checkout has no `node_modules` and I was told not to modify it. `npm run check` there took **34.8 s** total (`/tmp/check2.log`).
- `manifests:check`: passed (no failure output; the script that failed in the checkout failed only for missing `ajv`).
- `typecheck` (root `tsc -p .` + each plugin): passed for all 7 plugins, including `plugins/pr-reviews`.
- `test`: all pass. `plugins/pr-reviews`: **353 pass, 0 fail**. Others: boat-sandbox 169, code-explorer 121, grok-wake 68, subagents-strip 154, proactive-visuals 5, root scripts 5.
- `build` (`bb plugin build`): **FAILED for all 7 plugins**, an environment fault, not a code fault: `This plugin pins @get-bb/plugin-sdk 0.6.104; this bb's SDK is 0.6.132` (warning), then `Downloading the plugin build toolchain… Error: Cannot find module 'npm/package.json'` thrown from `.../bb-app/host-daemon/dist/bb-chunks/chunk-VQVNWIZF.js`. Re-running `bb plugin build` alone in `/tmp/prr-copy/plugins/pr-reviews` gave the same error. bb here is 0.49.0, and the package `engines.bb` is `>=0.48`, `bbPluginSdk >=0.6.104` (`P/package.json:20-23`).
- So on this machine `npm run check` fails at the last step (build) for every plugin today, independent of this branch. Typecheck and tests are green on `main`'s tree (branch status was clean).
- Live testing: `docs/remote-live-testing.md` (not read in detail). Checkout path is under `~/.bb-machines/`, so the `local_bb` wrapper rule applies.
