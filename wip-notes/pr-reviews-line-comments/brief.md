# Brief: pr-reviews — line selection and GitHub comments

## Goal
Ivan reviews PRs in the pr-reviews plugin and wants to act on code without leaving it: select lines in any diff the plugin shows, then either ask the review thread about them or post a GitHub review comment anchored to them; and turn a guide finding into a GitHub review comment, as is or edited. The plugin stops being read-only, but it only ever posts on an explicit click, after showing exactly what will be posted and where.

## Context
- Source: Ivan's request in thread thr_issin667dw (2026-11-09). Base: `main` @ a0b4890. Branch `bb/pr-reviews-line-selection-comment-on-findings-thr_issin667dw`.
- Plugin: `plugins/pr-reviews`. Full map: `research/map.md`; prior art: `research/prior-art.md`; merged facts: `context.md`.
- The other branch Ivan named (thr_vbgai69dm4, "Add changes tab") is merged as #44; its worktree is clean and its pr-reviews tree equals main. No conflict today.

## Requirements
1. **Line selection** in the Changes tab file diff AND in each guide step's diff: click a line number/line to select it, shift-click to extend, drag to select a range. The selection is visibly highlighted and clearable (Esc / click elsewhere).
2. From a selection, two actions:
   a. **Ask the review thread**: an inline question box (like "Ask about this"); Send posts file path, line range, side(s), the selected code, and the question to the PR's review thread (queued if busy), then opens Review chat. When the PR has no open review thread the action is disabled with "Start a review first".
   b. **Comment on GitHub**: an input box for the comment; before posting, the UI shows what will be posted and where (repo#PR, file, line range, side, commit short sha, and comment kind: line / file-level / general). Post only on an explicit click.
3. **Finding actions**: next to "Ask about this" on every finding (guide steps; overview list optional), a comment action with **Comment as is** (preview of the finding text → Post) and **Edit and comment** (input prefilled with the finding text → preview → Post). Anchored to the finding's line and side.
4. **Anchoring**: added + context lines post on side RIGHT; deleted lines on side LEFT (both sides allowed). Multi-line uses `start_line`/`start_side` + `line`/`side`; single line omits `start_*`. Anchor commit = the commit the user is viewing (the Changes diff's headSha, or the guide's headSha), named in the preview. GitHub may later mark it outdated; that is accepted.
5. **Fallback**: a range is line-commentable only when every line is inside one hunk of that file's diff, on a valid side. Otherwise: file in the PR → file-level review comment (`subject_type: file`) that quotes the lines (path, range, code block); file not in the PR → general PR comment (issue comment) quoting the same. The preview says which kind and why, before posting.
6. **Result**: success shows a link to the posted comment (`html_url`); failure shows a clear message (not signed in, no permission, PR closed/locked, GitHub validation 422, network) beside the draft, which is kept.
7. **Auth**: through the GitHub CLI already used (`gh api … --method POST`), on the host. Never ask for, store, or log tokens.
8. **Docs**: replace "Nothing is ever posted to GitHub" everywhere (package.json `bb.description` + regenerated manifests, PLUGIN_OVERVIEW.md, review-screens.tsx copy, SKILL.md, README if relevant) with wording that says it posts only the comments you write or choose, on your click. Review threads still never reach GitHub.
9. Tests for the pure logic (commentability/fallback decision, request building, message building, error mapping) and live verification with screenshots on a throwaway bb server; posting tested only against a throwaway PR we create and delete, or mocks.

## Non-goals
- Pending/batched reviews, approve/request-changes, replies, editing or deleting posted comments, listing existing GitHub comments in the diff.
- Suggestion blocks (```suggestion```).
- Letting the review thread post to GitHub (it still can't).
- Changing bb's SDK or other plugins.

## Glossary
- **selection** — a contiguous line range in one file's diff: `{path, side-of-start, start line, side-of-end, end line}` with old/new numbers per line.
- **line comment** — GitHub review comment with `subject_type: line` (single or multi-line).
- **file comment** — GitHub review comment with `subject_type: file`.
- **PR comment** — general issue comment on the PR.
- **comment target** — the computed `{kind: line|file|pr, commit, path, line range, sides, reason}` shown in the preview and used to post.
- **finding** — `Finding` in `src/guide/guide-schema.ts` (single `line` + `side`).
- **review thread** — the hidden bb thread that wrote the guide (`reviewThreadOf`).

## Open questions
- Diff rendering for selection: the SDK's `experimental_Diff` exposes no selection or line callbacks (map.md §1). Candidate: render with host-shared `@pierre/diffs/react` (bb's own diff library, shared with plugins like react/radix) + `experimental_useCodeTheme`, using its line selection and line annotations. Needs a devDependency (types) → ask Ivan. Alternative: hook the host diff's shadow DOM (fragile, undocumented).
