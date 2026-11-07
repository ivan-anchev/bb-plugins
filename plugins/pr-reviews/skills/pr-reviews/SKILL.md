---
name: pr-reviews
description: What the PR Reviews plugin's left-rail app shows (a GitHub project's open pull requests in a sidebar, and a page per pull request), how Start review runs a review thread in a new worktree, its Review instructions setting, where its data comes from (the GitHub CLI), and how to point a user at it.
---

# PR Reviews

The PR Reviews plugin adds a **PR Reviews** entry to bb's left rail. It has no
CLI command and no agent tool yet, and one setting.

## The sidebar

Opening PR Reviews replaces the thread list with:

- **A project picker** at the top. It lists only the bb projects whose git
  remote is on github.com (`git@github.com:owner/name.git`,
  `ssh://git@github.com/owner/name`, or `https://github.com/owner/name`). The
  remote is the one bb recorded for the project. When bb recorded none (a
  project created before its `origin` existed), PR Reviews reads
  `git remote get-url origin` in the project's default checkout instead. The
  last project chosen is remembered and opens again the next time PR Reviews
  opens.
- **The project's open pull requests**, in the order `gh pr list` returns them (newest first), up to 200.
  Each row shows `#number` and the title, then the author's GitHub login, how
  long ago the PR was last updated, and its review state: **Writing guide…**
  while a review thread is working on it, otherwise **No guide**.

## The page

Clicking a row opens that PR's page. Its header shows `#number` and the title,
the author, `head-branch → base-branch`, and a **GitHub** link that opens the
PR on github.com. Below it, one screen per review state:

- **No guide yet**, with **Start review**.
- **Writing the guide**, while the review thread works: a spinner, the time
  since the review started ("4:12 so far."), **Open thread**, and **Cancel**.
  Cancel stops the thread and the page returns to No guide yet. Cancel needs
  only bb, not GitHub, so it works while GitHub is unreachable. If bb cannot
  stop the thread, Cancel shows the error, the page keeps showing Writing the
  guide, and clicking Cancel again retries.
- **The review finished without a guide**, when the review thread for the PR's
  current commit stopped without submitting one: **Ask it to submit the
  guide** messages the thread to finish (the row reads Writing guide… while it
  answers), and **Open thread** shows what it said.

The page and the rows follow the review thread on their own; no refresh is
needed. Archiving or deleting a review thread returns the PR to No guide yet.

## Start review

Start review pins the PR's diff at its current head and base commits, fetches
both commits into the project's repository, then starts a thread titled
`Review #<number>: <title>` in the PR's bb project, in a new worktree of the
default branch (never your own checkout), with permission mode `auto`. Its
first message is PR Reviews' own rules, then the **Review instructions**
setting as written, then the PR's facts: title, author, branches, head and
base commits, and the list of hunks the guide must cover. The PR's text is
marked as untrusted, and the thread is told never to write to GitHub. Each
file in the hunk list is written as a JSON string, so a file name with an
invisible character (a zero-width space, a bidi override) shows it as an
escape such as `\u200B` instead of hiding it. The thread's plugin metadata
records `{repo, number, headSha}`.

Clicking Start review twice starts one thread. If a push lands while the diff
is being read, Start review says "The PR is being pushed to right now" and
starts nothing; try again.

A review thread cannot reach GitHub: bb's workspace sandbox blocks it. So
before the thread starts, PR Reviews runs `git fetch origin <head>:refs/pr-reviews/<number>/head
<base>:refs/pr-reviews/<number>/base` (by commit, so a later push cannot move
them) in the project's default checkout, whose repository the review worktree
shares. The thread is told not to run `gh` or fetch, to run `git checkout
--detach <head>`, and to read the change with `git diff <base>...<head>`,
which shows the same hunks as GitHub. If the fetch fails, Start review shows
"Could not fetch PR #<number>'s commits" with git's message, and starts
nothing.

The fetch runs on the machine that runs bb, so Start review works only for a
project whose default checkout is on that machine. For a project whose default
checkout is on another enrolled machine, Start review says "PR Reviews can
only review a project whose default checkout is on the machine running bb"
and runs nothing: no diff read, no fetch, no thread.

Submitting a guide is not available yet, so every review currently ends as
"The review finished without a guide".

## Settings

**Settings → PR Reviews → Review instructions** (`instructions`): a multi-line
text field, empty by default. Its text is sent as-is to every new review
thread, after PR Reviews' own rules. Put your review rules and any skill text
here. A blank field sends nothing.

## Refresh and errors

The **Refresh** button in the page's title bar re-reads the projects, the
pull request list, and the open PR. Clicking the PR that is already open does
the same for that PR and the list. When a read fails, its error shows above
whatever was already on screen, and the old list stays. Typical errors:

- "PR Reviews needs the GitHub CLI": `gh` is not installed or not on the
  login shell's `PATH`.
- "The GitHub CLI isn't signed in": run `gh auth login`, then Refresh.
- "Could not read the git remote of <project>": `git remote get-url origin`
  failed in that project's default checkout for a reason other than a missing
  checkout, a folder that is not a git repository, or a missing `origin` (those
  just leave the project out of the picker). The message is git's own, for
  example a broken `.git/config` or a permission error. The other projects
  still list.

## Where the data comes from

PR Reviews runs `gh pr list`, `gh pr view` and `gh pr diff` for the project's
`owner/name` on the machine that runs bb, and `git remote get-url origin` for a
project whose remote bb did not record. On Start review it also runs `git
fetch` in the project's default checkout, which only adds the refs under
`refs/pr-reviews/`. It only reads; it never writes to GitHub. The diff pinned for each reviewed commit and each review run are kept
in the plugin's own SQLite database (`plugins/pr-reviews/data.db` in bb's data
directory).
