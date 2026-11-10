---
name: pr-reviews
description: What the PR Reviews plugin's left-rail app shows (a GitHub project's open pull requests in a sidebar, a page per pull request with Summary, Changes and Guide tabs and a read-only side panel of reviewers, checks and labels, and a badge counting ready guides), what the Changes tab shows (the whole diff as a file tree beside a diff drawn like bb's own, with path, kind and extension filters, Unified or Split, and Wrap lines), how a guide reads (the What this PR does overview, the step-by-step walkthrough with its ←/→ and J/K keys, findings under their lines with Ask about this, Comment as is and Edit and comment, and the view options for tests and findings), how to select lines in any diff and ask the review thread about them, how to post a GitHub review comment on selected lines or a finding (a preview of exactly what will be posted and where, then Post to GitHub on an explicit click; review threads never post), how Start review runs a hidden review thread in a new worktree that finishes with the submit_review agent tool, the Review chat side panel that shows that thread's live conversation with a composer, how a guide for an older commit reads (New commits, with Update guide asking the same thread to update it), its Review instructions setting, where its data comes from and what it posts (the GitHub CLI), and how to point a user at it.
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

Clicking a row opens that PR's page. Its header shows the PR's state as an
icon before the title (green Open, grey Draft, purple Merged, red Closed; hover
it for the name), the title over `#number`, the author's GitHub avatar and
login, and `base-branch ← head-branch`; and icon buttons, each named by its
tooltip:
**Review chat** (opens the review thread's chat beside the page; shown once a
review has started, see "Review chat" below) and **Open on GitHub** (opens the
PR on github.com).

Under the header sit three tabs, **Summary**, **Changes** and **Guide**; a PR
opens on Summary. The Changes tab carries the PR's lines added and removed,
`Changes +A −D`, as GitHub counts them. The header and the tabs stay put, and each tab scrolls on its
own. Switching tabs keeps the guide where you left it, on the same step and
scroll position, and Changes on the same file, scroll position and open
folders. With focus on a tab, ← and → (and Home and End) move between the tabs.

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

**Changes** shows the PR's whole diff, base to head, as GitHub serves it now,
laid out like Code Explorer's Changes view. It needs no guide: it works on any
PR, before a review starts. It reads the diff (`gh pr diff`) the first time the
tab is opened, not when the page opens.

- **The tree**: every changed file in its folders, with its `+N −M` (an added
  file shows only `+N`, a deleted one only `−M`, a binary file "Binary") and a
  letter for how it changed (A, M, D or R). Click a file, or move to it with
  the arrow keys and press Enter or Space, to show its diff.
- **The diff**: the selected file's path over its diff, drawn with bb's own
  diff engine and code theme, so it looks like bb's diff view.
  A binary file, a file renamed without changes, or a file with no changed
  lines shows a sentence saying so instead. Once the file's text at the PR's
  head has loaded (`gh api`, for a modified or renamed file of up to 1 MB),
  clicking "N unmodified lines" between hunks shows those lines; until then,
  or when that read fails, the diff shows as the patch draws it.
- **The header**: "N files, +A −D" (hover or focus it for the lines by kind:
  code, tests, mocks, generated files, docs), then four icon buttons:
  - **Search filenames** opens a path filter: comma-separated plain text or
    globs (`*.md`, `docs/**`), with `!` to exclude (`!*.test.ts`). A renamed
    file matches by either path. Escape closes it and clears the filter.
  - **Filter files**: Hide tests, each kind, each file extension, Deleted
    files, and Reset filters. While a filter is on, the summary reads "M of N
    files" and the button carries a dot.
  - **Collapse all folders** / **Expand all folders**.
  - **Diff settings**: Unified or Split, and Wrap lines.
- **The divider** between the tree and the diff drags, or takes ← → (↑ ↓ when
  stacked), Home and End. Below a 48rem-wide panel the tree sits above the
  diff.

The path filter and the filters are kept per PR, and the diff settings for
every PR, until bb reloads.

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
page sends the thread appears there too: Ask about this, questions about
selected lines, Ask it to submit the guide, and Update guide.

The tab always shows the review thread of the PR on screen. Open another PR and
it shows that PR's thread, or says the PR has no review thread yet; when a PR
gets a new review thread, it switches to it. The panel's **+** menu also lists
Review chat on a PR's page. Close the tab with its ×, or the panel with the
title bar's panel button.

## Asking about lines

Every diff on the page can select lines: the Changes tab's file diff, each
guide step's hunks, and the overview's hidden hunks. Click a line number in the
gutter to select that line, shift-click another to extend the selection to it,
or drag over the numbers for a range. In Split view a range can start in one
column and end in the other. Clicking the code itself selects nothing.

The selected lines are highlighted, and under the last one a row names them
("line 12 (new)", "lines 26–31 (old)", or "line 26 (old) to line 63 (new)" for
a range across both sides) and offers **Ask the review thread** and **Comment on
GitHub** (see Commenting on GitHub). A context line
counts as new, whichever column it was clicked in. With no review thread yet
the button is disabled and the row says "Start a review first". Esc, or a
click outside the diff, clears the selection without leaving the page; with
nothing selected Esc does what it always does.

**Ask the review thread** opens a question box under the row, and the lines
stay selected while it is open: clicking other numbers does nothing until you
Cancel. **Send** messages the review thread, queued behind anything it is doing:
the file, the lines and their sides, the commit the diff shows, the selected
lines themselves (marked as untrusted PR data) and your question. Review chat
then opens, where the answer arrives, and the selection clears. If the send
fails, the question stays in the box with the error beside Send. A question
cancelled while it sends still goes to the thread, but the page no longer
follows it: Review chat stays as it is and the selection, or a newer one, stays.
Esc anywhere in an empty box, Cancel included, closes it; a box with text
ignores Esc, so a question is never lost to it.

## Commenting on GitHub

PR Reviews posts to GitHub only a review comment you wrote or picked, after a
preview, when you click **Post to GitHub**. It posts nothing else: no general PR
comment, review, approval, reply or edit. Review threads never post.

**Comment on GitHub** under selected lines opens a comment box; the lines stay
selected while it is open. **Preview** (once the box has text) shows exactly
what will be posted and where:

- "Post to owner/name#N as a line comment" (or "a file comment"), with
  "(closed)" or "(merged)" for a PR that is.
- The file, the lines, the side GitHub anchors to (`RIGHT` for added and
  context lines, `LEFT` for removed ones, `LEFT to RIGHT` for a range across
  both), and the short commit: the commit the diff shows, which GitHub may
  later mark outdated.
- Why it is a file comment, when it is.
- The comment's text exactly as it will be sent, unrendered.

The preview is made when you click Preview and stays as it is: a refresh of the
PR does not change it until **Back to edit** and Preview again. **Post to
GitHub** posts that comment through `gh` as your account and becomes "Posted.
View on GitHub ↗" with **Done**, which clears the selection. A double click
posts once, and a posted comment can't be posted again from the same box.

- **One line** is a line comment on that line. **Several lines inside one hunk**
  are a multi-line comment from the first to the last, across sides too.
- **Lines GitHub can't anchor to**, such as unchanged lines you expanded or
  lines across two hunks, become a comment on the whole file that starts by
  quoting them: the file, the lines and the commit, then the lines in a `diff`
  block, then your text.
- **A commit no longer in the PR** (force-pushed away) can't be commented on:
  Preview says "Commit abc1234 is no longer in the PR (force-pushed). To
  comment on the current code, Refresh and use the Changes tab, or update the
  guide." and the draft stays.
- **Over 65,536 characters**, GitHub's limit, the preview says so and Post is
  disabled.

If posting fails, the preview stays with the reason beside Post, and Back to
edit returns to your text: not signed in to `gh`, no permission, a locked
conversation, a PR or repository your account can't see, GitHub's own words
for a comment it refused (most often lines no longer in that commit's diff), no
network, or a comment too long to hand to `gh`. When GitHub doesn't answer
within a minute the comment may have been posted, so it says to check the PR
before posting again, and never retries by itself.

Esc never leaves the page from a comment box: it closes an empty write box, does
nothing in a box with text or a preview, and acts as Done once posted.

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
reader a decision, then its hunks: each one diff, drawn with bb's own diff
engine and code theme (as Code Explorer's diffs are), under its file path. A hunk the agent
collapsed is one line, its path and reason, with Show. A file with no text
changes (a binary file, a pure rename) is one line saying so.

A finding sits in a grey block directly under its line, inside its hunk's diff:
its priority, title and body, then **Ask about this**, **Comment as is** and
**Edit and comment**. A finding on a removed line
sits under that removed line, and the replaced pair keeps its word
highlighting. Findings on the same line stack in the order the thread gave
them. **Ask about this** opens a text box; **Send** messages
the question, quoting the finding, to the review thread, which answers there
(Review chat shows it). The page keeps reading Guide ready while the thread
answers. If the send fails, the question stays in the box with the error beside
Send. Text typed while a question is sending stays in the box, unsent. Esc
closes an empty box and leaves one with text, and the page, as they are.

**Comment as is** opens a GitHub comment on the finding's line and side, at the
guide's commit, straight at its preview, with the finding's title in bold over
its body; **Edit and comment** opens the same text in the comment box to change
first. Both then work as Commenting on GitHub describes. One of the three boxes
is open at a time, and closing one returns focus to its button.

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
pull request list, the open PR, its diff once the Changes tab has read it, its
guide, and the selected file's text. Clicking the PR that is already open does
the same as Refresh. When a read fails, its error shows above
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

PR Reviews runs `gh pr list`, `gh pr view` and `gh pr diff` (for the Changes
tab, and to pin a reviewed commit's diff) for the project's `owner/name` on the
machine that runs bb, and `git remote get-url origin` for a
project whose remote bb did not record. On Start review and Update guide it
also runs `git fetch` in the project's default checkout, which only adds the refs under
`refs/pr-reviews/`. Its one write is `gh api --method POST
repos/<owner>/<name>/pulls/<number>/comments`, run when you click Post to
GitHub on a previewed comment. The diff pinned for each reviewed commit, each review run, and each guide are
kept in the plugin's own SQLite database (`plugins/pr-reviews/data.db` in bb's data
directory).
