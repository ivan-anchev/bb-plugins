---
name: pr-reviews
description: What the PR Reviews plugin's left-rail app shows (a GitHub project's open pull requests in a sidebar, a page per pull request with Summary and Guide tabs and a read-only side panel of reviewers, checks and labels, and a badge counting ready guides), how a guide reads (the What this PR does overview, the step-by-step walkthrough with its ←/→ and J/K keys, findings under their lines with Ask about this, and the view options for tests and findings), how Start review runs a hidden review thread in a new worktree that finishes with the submit_review agent tool, the Review chat side panel that shows that thread's live conversation with a composer, how a guide for an older commit reads (New commits, with Update guide asking the same thread to update it), its Review instructions setting, where its data comes from (the GitHub CLI), and how to point a user at it.
---

# PR Reviews

The PR Reviews plugin adds a **PR Reviews** entry to bb's left rail. It has one
agent tool, `submit_review`, offered only to its own review threads, one
setting, and no CLI command.

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
  long ago the PR was last updated, and its review state: **Guide ready** when
  it has a guide for its current commit, **New commits** when its newest guide
  is for an older commit, **Writing guide…** while a review thread is working
  on it, otherwise **No guide**.

The rail entry shows a badge with the number of open pull requests in the
remembered project that read **Guide ready**, and no badge at zero.

## The page

Clicking a row opens that PR's page. Its header shows the title over
`#number`, the author's GitHub avatar and login, and `base-branch ← head-branch`;
the files and lines; and icon buttons, each named by its tooltip:
**Review chat** (opens the review thread's chat beside the page; shown once a
review has started, see "Review chat" below) and **Open on GitHub** (opens the
PR on github.com).

Under the header sit two tabs, **Summary** and **Guide**; a PR opens on
Summary. The header and the tabs stay put, and each tab scrolls on its own.
Switching tabs keeps the guide where you left it, on the same step and scroll
position. With focus on a tab, ← and → (and Home and End) move between the
tabs.

**Summary** shows the PR's own description, rendered as markdown under
"<author> wrote", or "No description provided." when the PR has none. Beside it,
a side panel shows the PR's details as GitHub has them, read only:

- **Reviewers**: everyone asked for a review that is still outstanding (a team
  shows as the team), and everyone whose latest review approved, requested
  changes or commented. Each row has a glyph for where they stand (Approved,
  Changes requested, Commented or Awaiting review, which screen readers hear by
  name), the GitHub avatar (the login's first letter when it fails to load), and
  the login or team name. Someone asked again after an earlier review shows as
  Awaiting review; dismissed and draft reviews are left out.
- **Checks**: one status beside the heading, `N failing` when any check fails,
  else `N running` when any is still pending, else `N passing`; then the checks
  by name, failing first, then pending, then passing. The first three always
  show; any more sit behind **Show N more**. Each check with a details page
  opens it outside bb; one without is plain text.
- **Labels**: one chip per label, with a dot in the label's GitHub color.

A section with nothing in it is left out, and a PR with no reviewers, checks or
labels has no side panel. The panel never changes anything on GitHub. It comes
with the PR's own read, so Refresh updates it. With no side panel, or on a page
narrower than 600px, the description takes the whole width.

**Guide** shows one screen per review state, and its label carries the state: a
dot once a guide exists, a spinner while the review thread writes one:

- **No guide yet**, with **Start review**.
- **Writing the guide**, while the review thread works: a spinner, the time
  since the review started ("4:12 so far."), **Review chat**, and **Cancel**.
  Cancel stops the thread and the page returns to No guide yet. Cancel needs
  only bb, not GitHub, so it works while GitHub is unreachable. If bb cannot
  stop the thread, Cancel shows the error, the page keeps showing Writing the
  guide, and clicking Cancel again retries.
- **The review finished without a guide**, when the review thread for the PR's
  current commit stopped without submitting one: **Ask it to submit the
  guide** messages the thread to finish (the row reads Writing guide… while it
  answers), and **Review chat** shows what it said.
- **The guide**, once one exists (see "Reading a guide" below).
- **The guide with new commits**, when the PR's newest guide is for an older
  commit: the guide shows as usual under a banner, "N new commits since this
  guide was written", with **Update guide** (see "Update guide" below). After a
  force push removed the guide's commit from the PR, the banner reads "The PR
  changed since this guide was written". New commits show after a Refresh.

The page and the rows follow the review thread on their own; no refresh is
needed. Archiving or deleting a review thread returns the PR to No guide yet.

## Review chat

Review threads are hidden from bb's thread sidebar: PR Reviews starts them
hidden, and the first time it loads it hides the ones it started earlier. A
review thread you show again yourself (`bb thread update <id> --visibility
visible`) stays shown.

**Review chat** opens a **Review chat** tab in the page's side panel with the
review thread's whole conversation, live: its messages, tool calls and a
composer to write to it. It is bb's own chat, so it streams, queues and stops
like any thread. While a review runs you watch the thread work. Everything the
page sends the thread appears there too: Ask about this, Ask it to submit the
guide, and Update guide.

The tab always shows the review thread of the PR on screen. Open another PR and
it shows that PR's thread, or says the PR has no review thread yet; when a PR
gets a new review thread, it switches to it. The panel's **+** menu also lists
Review chat on a PR's page. Close the tab with its ×, or the panel with the
title bar's panel button.

## Reading a guide

A guide opens on **What this PR does**:

- The guide's problem and approach, then **Before** and **After** lists when
  the change alters behaviour.
- **Findings**: each finding's priority, **Must fix**, **Should fix** or
  **Nit**, and its title, with **Step n** going to the step that shows its
  hunk. A finding on a hunk the guide leaves out, or on a test the view
  options hide, has no step link.
- **Not in this guide**: each hunk or set of files the agent left out, with
  its reason. Show expands the hunk's diff, or lists the files.
- A byline: "Written by <model> for <short commit>, <how long ago>" ("the
  review thread" when bb reported no model).

The bar at the bottom reads **Start the walkthrough · N steps**. Each step
shows its title, its explanation, **For you to decide** when the agent left the
reader a decision, then its hunks: each in bb's own diff view (the component
and code theme Code Explorer uses) under its file path. A hunk the agent
collapsed is one line, its path and reason, with Show. A file with no text
changes (a binary file, a pure rename) is one line saying so.

A finding sits in a grey block directly under its line in the step's diff: its
priority, title and body, and **Ask about this**. A finding on a removed line
that was replaced sits under the whole removed-and-added pair, so the pair keeps
its word highlighting. **Ask about this** opens a text box; **Send** messages
the question, quoting the finding, to the review thread, which answers there
(Review chat shows it). The page keeps reading Guide ready while the thread
answers. If the send fails, the question stays in the box with the error beside
Send. Text typed while a question is sending stays in the box, unsent.

The view-options icon at the right end of the tab bar, shown on the Guide tab
once there is a guide, opens a popover of switches, each shown only when the
guide has something for it:

- **Show tests and mocks**, off by default. Tests and mocks are spotted from
  the file path. While it is off, their hunks leave the steps, a step of tests
  alone leaves the walkthrough, the step count follows, and Not in this guide
  shows a Tests and mocks row whose Show turns the switch on.
- **Show findings**, on by default. Off, the overview's Findings and every
  block in the steps are hidden, and each diff is drawn whole.

The switches are remembered for the session, across PRs, and reset when bb
reloads. Turning one keeps the reader on their step, or on the nearest
earlier step still shown.

On a step the bar reads `‹ n / N ›`. **→** or **J** goes to the next step,
**←** or **K** to the previous one; Next on the last step returns to the
overview, and Previous on the first step does too. Hovering or focusing an
arrow shows where it leads ("What this PR does" before step 1, "Back to the
overview" after the last); Escape closes that tooltip. The keys do nothing
while you type in a text field, such as bb's composer in a split view, or
with ⌘, Ctrl or Alt held. All guide text renders inline markdown (`code`,
emphasis, links) the same way.

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

A PR that already has a guide for its current commit cannot be started again:
Start review says "This PR already has a guide for its current commit."

## Update guide

Update guide brings a guide for an older commit up to the PR's current head.
Like Start review, it first pins the PR's diff at the current head and base,
and fetches both commits into `refs/pr-reviews/<number>/`, in the project's
default checkout on the machine running bb (a checkout on another machine is
refused the same way). Then it messages the **same** review thread that wrote
the guide, queued behind anything it is still doing. The message gives the new
head and the guide's head, tells it to `git checkout --detach <new head>`, to
review only the new commits with `git diff <guide head>..<new head>`, and to
call `submit_review` again with a complete guide for the new head, covering
every hunk in the new hunk list it carries. From then on, that thread's
`submit_review` calls are accepted only for the new head, and checked against
its diff; a call its earlier turn makes for the old head is refused.

The row reads Writing guide… while the thread works, then Guide ready, and the
guide's byline names the new commit. The older guide is kept: it is stored by
its commit, and no submission can overwrite it once Update guide (or Start
review) has asked for a newer one, even after a Cancel. If the thread that wrote the guide was
archived or deleted, Update guide starts a new review instead, exactly as Start
review does. Clicking Update guide twice sends one message. If it fails, the
error shows beside the button and the guide stays.

## The submit_review tool

A review thread finishes by calling `submit_review` with the head commit the
guide is for (`headSha`, as Start review's or Update guide's message names it)
and the whole guide: `overview` (`problem`, `approach`, optional `behaviour {before, after}`), 1 to
7 `steps` (each a `title`, an `explanation`, an optional `forYou`, and `hunks`
of `{file, hunk, collapsed?}`), `hidden` (`{file, hunk, reason}` or `{files,
reason}`), and `findings` (`{file, line, side?, priority: p0|p1|p2, title,
body}`). A hunk is named by its range header (`@@ -18,9 +18,19 @@`; the `@@`
marks, trailing function text and an omitted `,1` are accepted), and a file
with no text changes by `whole file`.

The tool is offered only to threads PR Reviews started, recognised by the
thread's origin and its `{repo, number, headSha}` metadata; a thread started
from bb's composer does not have it. A PR has one review run at a time: the
review Start review or Update guide last asked for, replacing any earlier one.
On each call PR Reviews looks up the thread's run, accepts the call only when
its `headSha` is that run's commit, checks the guide against the diff pinned for
it, and stores it by repo, PR number and head commit. A second accepted guide
for the same commit replaces the first. A rejected call saves
nothing, and its message lists every problem at once:

- **Missing**: hunks in no step and not in `hidden`.
- **Listed more than once**: hunks placed twice, with both places.
- **Unknown files** and **Unknown hunks** (with the file's real hunks).
- **Findings outside the diff**: a finding's line is in none of its file's
  hunks on that side (the message lists the file's line ranges).

More than 7 steps is refused by the tool's own input check: "Invalid arguments
for tool "submit_review": steps: Too big: expected array to have <=7 items".
A call for any other commit, or from a thread whose review was cancelled or
replaced by a newer review, is refused ("this thread is not writing a guide for
"<headSha>" in PR Reviews"); the refusal never names the run's commit.

When a guide is accepted, the row turns to Guide ready, the page shows the
guide, and the badge counts it, without a refresh.

## Settings

**Settings → PR Reviews → Review instructions** (`instructions`): a multi-line
text field, empty by default. Its text is sent as-is to every new review
thread, after PR Reviews' own rules. Put your review rules and any skill text
here. A blank field sends nothing.

## Refresh and errors

The **Refresh** button in the page's title bar re-reads the projects, the
pull request list, the open PR, and its guide. Clicking the PR that is already
open does the same for that PR, its guide and the list. When a read fails, its error shows above
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
project whose remote bb did not record. On Start review and Update guide it
also runs `git fetch` in the project's default checkout, which only adds the refs under
`refs/pr-reviews/`. It only reads; it never writes to GitHub. The diff pinned for each reviewed commit, each review run, and each guide are
kept in the plugin's own SQLite database (`plugins/pr-reviews/data.db` in bb's data
directory).
