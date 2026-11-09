# Goal
We are extending the bb plugin `plugins/pr-reviews` (repo root: /home/user/.bb-machines/ivananchev.getbb.app/checkouts/project-proj-uta6n4q3v8, branch based on main) with two features:
1. Line selection in a file's diff (Changes tab, and possibly the guide's step diffs): click a line, shift-click or drag a range. From the selection the user can (a) send it to the PR's review thread ("Review chat") as context (file, line range, code) to ask about it, or (b) post a GitHub PR review comment anchored to those lines (single- or multi-line), via an input box.
2. On each finding in the guided review (which has an "Ask about this" button), a comment action: "Comment as is" (posts the finding text as a GitHub review comment on the finding's lines) or "Edit and comment" (input prefilled with the finding text).
Posting only on explicit click, with a preview of what/where, a success link and clear errors. Lines outside the PR diff fall back to a file-level or general PR comment.

# Role
Read and follow /tmp/bb-provider-bridge-provider-claude-code-AvSM7l/skills/bb-claude-skill-plugins-GrxGyB/f699f89535e2d06e/skills/assistant-to-the-regional-manager/roles/researcher.md. Your mode is **map**. Read-only: never edit project files. Report facts, not plans.

# Out of scope
Anything outside plugins/pr-reviews and the plugin SDK it uses. No implementation advice.

# Questions (answer each with file:line citations)
1. The diff rendering: `experimental_Diff` from `@get-bb/plugin-sdk/app` as used in plugins/pr-reviews/src/app/changes/diff-viewer.tsx and src/app/guide/hunk-block.tsx. Read the SDK contract (node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts, and whatever else ships in node_modules/@get-bb/plugin-sdk) and report EVERY prop it accepts: is there any line selection, line click/gutter callback, line annotations / render-under-line slot, selected-range highlight, or hover utility? How does the guide currently place a finding block under its line (src/app/guide/finding-segments.ts, hunk-block.tsx)? What DOM does the host's diff render (data attributes for line numbers/sides) that the plugin could rely on, if any is documented? Also check other plugins in this repo (plugins/*) and the bb app's own code-explorer plugin if its source is present anywhere on disk, for line selection prior use.
2. GitHub access: how the plugin runs gh (src/github/gh.ts, host-command.ts), how errors map to refusals, and whether anything currently writes to GitHub. Is the PR's head commit (headSha) and the pinned diff available server-side for a given PR (store.ts, reviews.ts, rpc-handlers.ts), and how is the diff parsed into hunks with line numbers (src/diff/*)? Could the server tell whether a given new-side line range falls inside a hunk from existing helpers?
3. The review thread and Ask about this: how askAboutFinding flows from app (src/app/queries.ts, finding-block.tsx) through contract.ts, rpc-handlers.ts, reviews.ts, prompt.ts (askMessage). What happens when the PR has no review thread yet, or a running one? How does Review chat open (src/app/review-chat/*)?
4. Finding shape: guide-schema.ts — what location info does a finding carry (path, line, side, range)? Is it on the new side? How does walkthrough.ts map it?
5. Conventions: AGENTS.md, plugins/pr-reviews/README.md, PLUGIN_OVERVIEW.md, skills/pr-reviews/SKILL.md — every place that claims nothing is posted to GitHub (list file:line). Test conventions (node --test, fixtures). UI primitives available in src/app/ui (button, popover, menu, tooltip, notice).
6. Checks: run `npm run check` from the repo root (or the plugin's typecheck/test if check is heavy) and report pass/fail, plus how long it takes.

# Return
Write your full report to /home/user/.bb-machines/ivananchev.getbb.app/checkouts/project-proj-uta6n4q3v8-obs/pr-reviews-line-comments/research/map.md (one heading per question, cite file:line), then reply with a 10-line summary.
