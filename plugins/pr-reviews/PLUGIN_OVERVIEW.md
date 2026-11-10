PR Reviews adds a **PR Reviews** app to bb's left rail. It lists a GitHub
project's open pull requests and opens each one on a page with its whole diff
in a file tree and a guided review, written by a review thread, that walks you
through the change step by step. It posts to GitHub only the review comments
you write or pick from the guide, after a preview of exactly what and where, on
your click; review threads never post to GitHub.

## What you get

- **Your GitHub projects**: the sidebar's picker lists the bb projects whose
  git remote is on github.com, and remembers the one you chose last.
- **Open pull requests**: each row shows the PR's number, title, author, when
  it was last updated, and its review state in words.
- **A page per pull request**: an icon for whether it is open, a draft,
  merged or closed, its title, author, `base ← branch`, and Review chat and
  GitHub icon buttons, above three tabs: **Summary**, the author's own
  description beside the PR's reviewers, checks and labels; **Changes**, the
  PR's whole diff, with its `+N −M` on the tab; and **Guide**, which keeps its
  step while you switch and marks a ready guide with a dot.
- **Changes**: every changed file in a tree with its `+N −M`, beside the
  selected file's diff, drawn like bb's own. Click "N unmodified lines" to
  show the lines between hunks. Filter by path (globs, `!` to exclude), by
  kind, extension or deleted files; switch between Unified and Split, wrap
  lines, and collapse or expand every folder. It needs no guide, and reads
  the diff only once you open the tab.
- **Start review**: starts a review thread in a new worktree, with your
  Review instructions from Settings → PR Reviews. The page shows it writing,
  with the time so far, Review chat and Cancel, and asks it to finish if it
  stops without a guide.
- **A checked guide**: the thread hands in its guide with the `submit_review`
  tool, which only review threads get. PR Reviews rejects a guide that leaves
  out a hunk of the diff, lists one twice, or has more than 7 steps, and says
  exactly what to fix. The row then reads Guide ready, and the rail badge
  counts the ready guides.
- **Review chat**: review threads stay out of bb's thread sidebar. Review
  chat opens the PR's review thread beside its page, the whole conversation
  live with a composer, so you can watch it work and ask it anything. Ask
  about this, the nudge and Update guide all show up there.
- **What this PR does**: the guide opens on an overview: the problem and the
  approach, before and after when behaviour changes, what the guide leaves out
  and why, and who wrote it.
- **One step at a time**: Start the walkthrough shows each step's
  explanation, any decision left to you, and its code, drawn like bb's own
  diffs, with each finding under its line. Move with ← and → (or J and K); each
  arrow's tooltip names the step it leads to, and Next on the last step
  returns to the overview.
- **Findings, second**: the overview lists the thread's findings, Must fix,
  Should fix or Nit, each linking to its step, and each step shows a finding
  in a grey block under its line. Ask about this sends the thread a question
  about it; the answer is in Review chat. Comment as is and Edit and comment
  turn it into a GitHub comment on its line.
- **Ask about lines**: click, shift-click or drag over the line numbers in
  any diff to select lines, then ask the review thread about them; the
  question goes with the quoted lines, and the answer is in Review chat.
- **Comment on GitHub**: from selected lines or a finding, write a review
  comment, then Preview shows exactly what will be posted and where: the PR,
  line or file comment, file, lines, side, commit and the text. Post to GitHub
  posts it and links to it; nothing is posted before that click. Lines GitHub
  can't anchor to become a file comment quoting them, and the preview says
  why.
- **New commits**: when a PR moves past its guide, the row reads New commits
  and the guide stays readable under "N new commits since this guide was
  written". Update guide asks the same review thread to read only the new
  commits and hand in a complete guide for the new head.
- **View options**: switches to show tests and mocks (hidden by default) and
  findings (shown by default).
- **Errors beside your data**: if GitHub can't be read, the error shows above
  the list you already had. Refresh, or click the open PR again, to retry.

## How it works

PR Reviews reads pull requests with the GitHub CLI (`gh`) on the machine that
runs bb, so `gh` must be installed and signed in there. It writes to GitHub
only when you click Post to GitHub on a previewed review comment, as your `gh`
account; it never approves, requests changes or edits anything. Review threads
never reach GitHub at all: before one starts, PR Reviews fetches the PR's commits
into the project's repository with `git fetch`, and the thread reads them
there. So Start review needs the project's default checkout on the machine
that runs bb.
