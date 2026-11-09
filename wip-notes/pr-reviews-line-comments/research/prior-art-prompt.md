# Goal
We are adding to a code-review UI (a bb plugin that shows a GitHub PR's diff) the ability to select a line range in a diff and post a GitHub PR review comment anchored to it (single- or multi-line), and to post review comments from AI-written findings anchored to the finding's lines. When the lines are not in the PR diff, GitHub rejects a line comment, so the tool must fall back (file-level comment via subject_type=file, or a general PR comment quoting the lines). Posting goes through the GitHub CLI (`gh api`).

# Role
Read and follow /tmp/bb-provider-bridge-provider-claude-code-AvSM7l/skills/bb-claude-skill-plugins-GrxGyB/f699f89535e2d06e/skills/assistant-to-the-regional-manager/roles/researcher.md. Your mode is **prior-art**. Read-only.

# Out of scope
Our repo's code. Implementation advice for our code.

# What to find
How reputable projects (bar in the role file) do this, for example microsoft/vscode-pull-request-github, pwntester/octo.nvim, reviewdog/reviewdog, dlvhdr/gh-dash, or others you find. For each, with links to source files:
- The exact GitHub REST/GraphQL calls used to post a single- and multi-line review comment (fields: commit_id, path, line, side, start_line, start_side, subject_type), and whether they post standalone comments or pending reviews.
- How they decide whether a line is commentable (inside a diff hunk, on which side) before posting, and what they do when it isn't (fallback, error, disabled UI).
- How they handle the PR head moving after the diff was read (commit_id choice, outdated comments).
- Error cases GitHub returns (422 messages such as "pull_request_review_thread.line must be part of the diff") and how they surface them.
- UX for range selection in a diff (click, shift-click, drag, gutter) and confirmation before posting.
Also cite the GitHub REST docs for POST /repos/{owner}/{repo}/pulls/{pull_number}/comments and the issue-comments endpoint.

# Return
Write the report to /home/user/.bb-machines/ivananchev.getbb.app/checkouts/project-proj-uta6n4q3v8-obs/pr-reviews-line-comments/research/prior-art.md (heading per project, links), then reply with a 10-line summary.
