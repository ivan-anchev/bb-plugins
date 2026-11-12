---
name: pr-reviews
description: What the PR Reviews plugin's left-rail app shows (a sidebar of your pull requests across every GitHub project, in Authored by me, Needs my review and Recently merged sections with stacked pull requests as trees, one attention dot per row and a Filter that hides the sections you don't watch, a page per pull request with a state pill that changes its state on GitHub (ready for review, convert to draft, close by press and hold, reopen), Summary, Changes and Guide tabs and a read-only side panel of reviewers, checks and labels, and a badge counting ready guides), the Summary tab's Activity (conversation comments, reviews with their threads as rows that open the Changes tab, commits and events folded into lines that open in place, and a composer that posts a conversation comment, with Quote), what the Changes tab shows (the whole diff as a file tree beside a diff drawn like bb's own, with path, kind and extension filters, Unified or Split, and Wrap lines), how a guide reads (the What this PR does overview, the step-by-step walkthrough with its ←/→ and J/K keys, findings under their lines with Ask about this and Comment, and the view options for tests and findings), how to select lines in any diff with the gutter's + and use the one comment box under them (Write and Preview tabs, Ask about this to ask the review thread, Comment to post a GitHub review comment on an explicit click; review threads never post), how the PR's GitHub review threads show in every diff (under their lines above any finding, or at their file, outdated ones over their original lines; long threads, bot comments and resolved threads folded) with Reply, Ask about this and Quote reply in the same box, how Start review runs a hidden review thread in a new worktree that finishes with the submit_review agent tool, the Review chat side panel that shows that thread's live conversation with a composer, how a guide for an older commit reads (New commits, with Update guide asking the same thread to update it), its Review instructions setting, where its data comes from and what it posts (the GitHub CLI), and how to point a user at it.
---

# PR Reviews

The PR Reviews plugin adds a **PR Reviews** entry to bb's left rail. It has one
agent tool, `submit_review`, offered only to its own review threads, one
setting, and no CLI command.

## The sidebar

Opening PR Reviews replaces the thread list with your pull requests across
every bb project whose git remote is on github.com
(`git@github.com:owner/name.git`, `ssh://git@github.com/owner/name`, or
`https://github.com/owner/name`). The remote is the one bb recorded for the
project. When bb recorded none (a project created before its `origin`
existed), PR Reviews reads `git remote get-url origin` in the project's default
checkout instead. There is no project picker. Three sections show, in this
order, each with a sticky heading and its count; an empty one shows one quiet
line instead:

- **Authored by me**: your open pull requests, drafts included, and the ones
  you closed without merging in the last 7 days. Most recently updated first.
- **Needs my review**: open, non-draft pull requests by others that request a
  review from you or a team you are on (GitHub's `review-requested:@me`). Most
  recently updated first.
- **Recently merged**: pull requests you authored or reviewed that merged in
  the last 7 days. Most recently merged first.

**Filter sections.** The Filter icon at the top right of the sidebar opens a
menu, **Show sections**, with one checkbox per section and its count, and
**Show all sections**. Unchecking a section hides it; the menu stays open
while you toggle. While any section is hidden the Filter icon shows pressed,
with a dot. Hiding all three leaves one line, "All sections are hidden.", with
**Show all**. The choice is kept in this browser across reloads, not on the
bb server, so another browser or computer starts with all three shown.
A stack-mate row still says where it is listed (**Yours**, **Review**) when
that section is hidden.

Each search reads up to 100 pull requests. Each row is one line: the author's
GitHub avatar (two initials when it has none), the title, cut to one line, and
at the end a coloured icon for a merged (purple), closed (red) or draft (grey)
pull request; an open one shows none. Rows show no number and no guide state.
Hovering a row, focusing it with the keyboard, or opening it shows the repo's
name at its end; the row's tooltip names the title, `owner/name #number` and
the author.

A row may carry one dot on its avatar's corner, the first of: **CI failing**
(red), **Changes requested** (amber), **New activity** (white in the dark
theme): GitHub updated the pull request after you last opened its page in PR
Reviews. A pull request you never opened has new activity only in Needs my
review. Merged and closed pull requests carry no dot. The tooltip and a screen
reader name the dot in words. If PR Reviews cannot record that you opened a
page, the page says so above its header with **Try again**.

**Stacks.** A pull request whose base branch is another pull request's head
branch, in the same repo, sits on it. When a section lists two or more pull
requests of one stack, they show as a tree under a heading **Stack #N** (N is
the bottom pull request, the one the others build on) with how many of the
stack's pull requests the section lists ("3 of 5"). The tree lists the whole
stack, top first with the bottom pull request last, so a merged bottom stays in
place; a pull request of the
stack listed in another section, or in none, is a dim row that says where it is
listed (**Yours**, **Review**, or its merged icon). When a section lists only
one pull request of a stack, it is a plain row with its place, such as `1/7`.
The stack's other pull requests come from each listed repo's open pull
requests (up to 100) and its 20 most recently merged ones.

Clicking a row, dim ones included, opens that pull request's page in the first
bb project (in bb's project order) with its repo. A repo that no bb project has
lists nothing.

The rail entry shows a badge with the number of open pull requests that have a
guide for their current commit, in the project of the pull request page you
opened last, and no badge at zero.

## The page

Clicking a row opens that PR's page. Its header shows the PR's state as a pill
on its own line (green Open, grey Draft, purple Merged, red Closed) with
`owner/repo #number` beside it, then the title over the author's GitHub avatar
and login and `base-branch ← head-branch`; and icon buttons, each named by its
tooltip:
**Review chat** (opens the review thread's chat beside the page; shown once a
review has started, see "Review chat" below) and **Open on GitHub** (opens the
PR on github.com).

### Changing the state

The pill opens a menu of the changes GitHub allows: click it, or focus it and
press Enter, Space or ↓ (the arrows move, Esc closes it). Each row names the
state it leads to on a chip. An open PR offers **Convert to draft** and **Hold
to close**; a draft, **Ready for review** and **Hold to close**; a closed PR,
**Reopen** (a closed draft comes back as GitHub decides, as a draft). Close runs
only after you hold its row about 0.7 seconds, with the pointer or with Enter or
Space, as a red wash fills it; a shorter press says "Keep holding to close".
The others run on one choice. A merged PR's pill is not a button; hovering it
says "Merged pull requests can't change state".

While `gh` runs, the chosen row says so ("Converting to draft…") and the menu
stays open. Once GitHub has the change the menu closes, and the pill and the
sidebar row show the new state without a Refresh; the sidebar row can take a
few seconds longer, while GitHub's search catches up. If GitHub refuses, the
reason shows under the rows and nothing changes: not signed in to `gh`, no
permission, no network, a PR your account can't see, or a PR merged or closed
on GitHub since the page read it (Refresh to see it). When GitHub doesn't
answer within a minute the change may still have happened, so it says to
Refresh and check before trying again, and never retries by itself.

Under the header sit three tabs, **Summary**, **Changes** and **Guide**; a PR
opens on Summary. The Changes tab carries the PR's lines added and removed,
`Changes +A −D`, as GitHub counts them. The header and the tabs stay put, and each tab scrolls on its
own. Switching tabs keeps the guide where you left it, on the same step and
scroll position, and Changes on the same file, scroll position and open
folders. With focus on a tab, ← and → (and Home and End) move between the tabs.

**Summary** shows the PR's own description, rendered as markdown, or "No
description provided." when the PR has none, and under it the PR's **Activity**
(see "Activity" below). Beside them, a side panel shows the PR's details as
GitHub has them, read only:

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

### Activity

Under the description, **Activity** shows what happened on the PR, oldest
first, the way GitHub's Conversation tab does, under a muted divider for each
day:

- **Conversation comments** and **reviews with a body or an open thread** sit on
  the page: the avatar, the name, `author` after the PR author's, `bot` after an
  app's, a review's verdict (`approved` in green, `requested changes` in red,
  else `reviewed`), how long ago, and the markdown. A bot's body is clamped to
  three lines with **Show more**; nobody else's is. **Quote** and a link to
  GitHub show on hover or focus.
- **A review's threads** show under it as rows in a tinted group: the file name
  and line in monospace, the thread's first line, and "resolved", "outdated" or
  both when they apply. A row opens the **Changes** tab at that file, with the
  thread opened, in view and focused; if the Changes filters hide the file,
  they are cleared. A thread on a file the diff no longer changes is plain
  text, with "not in this diff" after its state, and opens nothing.
- **Commits and events** (labels, title changes, review requests, assignees,
  milestones, force-pushes, base branch changes, mentions, ready for review,
  draft, closed, reopened, branch deleted or restored, auto-merge) between two
  messages fold into one line, such as "1 commit and 2 label changes · 6d ago",
  with no names until you open it. Enter or a click opens and closes it in
  place. A label added and later removed in the same run counts as one change.
  A run of one shows that commit or event in full.
- **A review with only a verdict** is one line, "X approved · 5d ago". A review
  whose threads are all resolved is one line too, "X reviewed · 1 resolved
  thread · 6d ago", which opens to the whole review, with **Collapse**.
- **The merge** is one line with the merged glyph, "X merged into main". The
  close a merge causes is left out.

Lines between two messages sit together in one recessed tinted block. Which
lines you opened is kept while the page is open; whether a review folds comes
from each read, so a thread GitHub reopens shows its review open again. When a
read changes how a review shows while focus is in it, focus moves to the line,
the review or Collapse that replaces it.

At the foot, the comment box comments on the PR's conversation: write, preview,
then **Comment** (⌘↵) posts it (see "Commenting on GitHub"). **Quote** on a
message adds it to the box as a `> ` quote after any text there, and takes you
to the box; nothing posts before Comment. The posted comment shows in the
activity when it re-reads.

Activity comes from the same read as the review threads, so Refresh updates it,
and a failed read shows its error above the activity already shown.

**Changes** shows the PR's whole diff, base to head, as GitHub serves it now.
It needs no guide: it works on any PR, before a review starts. It reads the diff (`gh pr diff`) the first time the
tab is opened, not when the page opens.

- **The tree**: every changed file in its folders, with its `+N −M` (an added
  file shows only `+N`, a deleted one only `−M`, a binary file "Binary") and a
  letter for how it changed (A, M, D or R). Click a file, or move to it with
  the arrow keys and press Enter or Space, to show its diff.
- **The diff**: the selected file's path over its diff, drawn with bb's own
  diff engine and code theme, so it looks like bb's diff view.
  A binary file, a file renamed without changes, or a file with no changed
  lines shows a sentence saying so instead, with the file's review threads
  under it. Once the file's text at the PR's
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
  guide** messages the thread to finish (the page reads Writing the guide while
  it answers), and **Review chat** shows what it said.
- **The guide**, once one exists (see "Reading a guide" below).
- **The guide with new commits**, when the PR's newest guide is for an older
  commit: the guide shows as usual under a banner, "N new commits since this
  guide was written", with **Update guide** (see "Update guide" below). After a
  force push removed the guide's commit from the PR, the banner reads "The PR
  changed since this guide was written". New commits show after a Refresh.

The page and the badge follow the review thread on their own; no refresh is
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

## Selecting lines and the comment box

Every diff on the page can select lines: the Changes tab's file diff, each
guide step's hunks, and the overview's hidden hunks. Hover a line to show the
gutter's **+** (the one bb's own Changes tab shows): click it to select that
line, or drag from it for a range. Clicking a line number selects that line
too, shift-click extends the selection, and a drag over the numbers selects a
range. In Split view a range can start in one column and end in the other. A
context line counts as new, whichever column it was clicked in. Clicking the
code itself selects nothing.

Each diff has one comment box. Selecting lines highlights them and opens the
box under the last one, after any finding there, with its text field focused.
Pick other lines in the same diff and the box moves there, keeping what you
wrote. The box has:

- **Write** and **Preview** tabs (← and → switch them): you write markdown,
  and Preview renders it as bb's chat does, at the same size and inset.
  ⌘B, ⌘I, ⌘E and ⌘K (Ctrl on Windows and Linux) wrap the selected text in
  bold, italic, `code` or a link.
- **×** to discard: the text and the selection go.
- **Ask about this** and **Comment** at the bottom. Both need some text.

Esc in an empty box closes it and clears the lines; a box with text ignores
Esc, so a draft is never lost to it. While the box is open, Esc elsewhere on
the page, after a click outside it, does nothing; with nothing open, Esc does
what it always does. Pressing the one selected line's number again closes an
empty box; a box with text stays where it is, with nothing selected.

**Ask about this** messages the review thread, queued behind anything it is
doing: the file, the lines and their sides, the commit the diff shows, the
selected lines themselves (marked as untrusted PR data) and your text, as
markdown. The box then says "Sent to the review thread", with **Open Review
chat**, where the answer arrives, and **Done**. With no review thread yet Ask is
disabled and the box says "Start a review first". If the send fails, the text
stays in the box with the error beside the buttons until you change the text.

If you change the text while Ask or Comment is still sending, the box stays
open with your new text, unsent. A line above the buttons says the earlier text
went ("Commented with your earlier text." with **View on GitHub ↗**, or "Sent
your earlier text to the review thread." with **Open Review chat**), and Esc
keeps the box as for any text. When a send finishes, **Done** takes focus only
if focus was in that box; focus you have moved on, such as into another step's
box, stays where it is.

## GitHub's comments in the diffs

Every review thread GitHub has on the PR shows in each diff that holds it: the
Changes tab's file diff and the guide step whose hunk has its lines. A thread
sits under its last line, above any finding there, as one tinted block with no
border. Each comment shows its author's avatar and name, `author` after the
PR author's, `bot` after an app's, how long ago it was written (the exact time
on hover), and its markdown, in GitHub's order. **Quote** and a link to the
comment on GitHub show when you hover or focus the comment.

- **A long thread** (more than three comments) shows its first and latest
  comments, with **N more** between them to show the rest.
- **A bot's comment** is clamped to three lines, with **Show more**.
- **A resolved thread** is one row, "Resolved · name · first line", with the
  number of comments when there is more than one; the row opens it. Open, its
  footer says "Resolved by X", with **Collapse**. A thread GitHub reopens shows
  open again on the next read.

Threads on no line of the diff show above it, at their file. A comment on the
whole file needs no label. An **Outdated** thread, whose lines GitHub no longer
has in the PR's diff, shows the lines it was written on under that word; when they are wider than the
thread, Tab to them and scroll them with the arrow keys. A
thread on another commit's lines than the diff shows, such as a guide written
before new commits, says "On another commit" the same way. In a guide, a
file's threads at the file show on its first hunk in each step; a file with no
text changes shows them under its one line, in a step or under "Not in this
guide".

**Reply** and **Ask about this**, under a thread, open the diff's one comment
box there, keeping any text it held. **Quote** on a comment does the same and
adds the comment as a `> ` quote after that text, as GitHub's Quote reply does.
In a thread the box's buttons are **Ask about this**, which sends the review
thread your question with the GitHub thread's comments, and **Reply** (⌘↵),
which posts your text as a reply in that thread.

## Commenting on GitHub

PR Reviews posts to GitHub only a review comment, reply or conversation
comment you wrote or picked, when you click **Comment** or **Reply** (or press
⌘↵, Ctrl+↵ off a Mac) in a comment box, from any tab. The only other change it
makes on GitHub is a PR's state, when you choose it from the header's state
pill (see "Changing the state"). It posts nothing else: no review, approval,
merge or edit. Review threads never post. A conversation comment,
from the Summary tab's box, goes to the PR's conversation, on no file.

The comment goes through `gh` as your account, on the commit the diff shows,
which GitHub may later mark outdated. The box then reads "Commented", with
**View on GitHub ↗** and **Done**, and the PR's comments are read again, so the
new comment or reply shows in its thread in place. A double click posts once.

- **One line** is a line comment on that line: the `RIGHT` side for added and
  context lines, `LEFT` for removed ones. **Several lines inside one hunk**
  are a multi-line comment from the first to the last, across sides too.
- **Lines GitHub can't anchor to**, such as unchanged lines you expanded or
  lines across two hunks, become a comment on the whole file that starts by
  quoting them: the file, the lines and the commit, then the lines in a `diff`
  block, then your text.

The box says where a comment goes only when that isn't obvious, in a line
above the buttons: "Comments on commit abc1234, not the latest." when the diff
shows an older commit than the PR's (a guide written before new commits), and
"Posts as a file comment:" with the reason for a file comment.

Comment is disabled, with the reason beside the buttons, for:

- **A commit no longer in the PR** (force-pushed away): "Commit abc1234 is no
  longer in the PR (force-pushed). To comment on the current code, Refresh and
  use the Changes tab, or update the guide."
- **Over 65,536 characters**, GitHub's limit, quote included.

If posting fails, the text stays with the reason beside the buttons, until you
change the text or one of the reasons above disables Comment, which then shows
instead: not
signed in to `gh`, no permission, a locked conversation, a PR or repository
your account can't see, GitHub's own words for a comment it refused (most
often lines no longer in that commit's diff), no network, or a comment too
long to hand to `gh`. When GitHub doesn't answer within a minute the comment
may have been posted, so it says to check the PR before posting again, and
never retries by itself.

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
engine and code theme, under its file path. A hunk the agent
collapsed is one line, its path and reason, with Show. A file with no text
changes (a binary file, a pure rename) is one line saying so.

A finding sits in a grey block directly under its line, inside its hunk's diff:
its priority, title and body, then **Ask about this** and **Comment**. A
finding on a removed line
sits under that removed line, and the replaced pair keeps its word
highlighting. Findings on the same line stack in the order the thread gave
them. Both buttons select the finding's line and open the diff's comment box
under the finding (see Selecting lines and the comment box). **Ask about this**
opens it empty; asking from it, while the box is still on that line, sends the
question quoting the finding, so the thread knows which one. **Comment** fills
the box with the finding's title in bold over its body, unless the box already
holds your text, and posts it as Commenting on GitHub describes. Closing the box
returns focus to the finding's button.

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

The page reads Writing the guide while the thread works, then shows the guide,
and the guide's byline names the new commit. The older guide is kept: it is stored by
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

When a guide is accepted, the page shows the guide and the badge counts it,
without a refresh.

## Settings

**Settings → PR Reviews → Review instructions** (`instructions`): a multi-line
text field, empty by default. Its text is sent as-is to every new review
thread, after PR Reviews' own rules. Put your review rules and any skill text
here. A blank field sends nothing.

## Refresh and errors

The **Refresh** button in the page's title bar re-reads the sidebar's pull
requests, the open PR, its diff once the Changes tab has read it, its
guide, and the selected file's text. Clicking the PR that is already open does
the same as Refresh. When a read fails, its error shows above
whatever was already on screen, and the old sidebar stays. GitHub-side
changes (new pull requests, merges, reviews, CI) show after a Refresh; review
threads starting or stopping, and a state change made from the pill, re-read
the sidebar on their own. Typical errors:

- "PR Reviews needs the GitHub CLI": `gh` is not installed or not on the
  login shell's `PATH`.
- "The GitHub CLI isn't signed in": run `gh auth login`, then Refresh.
- "Could not read the git remote of <project>": `git remote get-url origin`
  failed in that project's default checkout for a reason other than a missing
  checkout, a folder that is not a git repository, or a missing `origin` (those
  just leave the project out of the sidebar). The message is git's own, for
  example a broken `.git/config` or a permission error. The other projects
  still list.

## Where the data comes from

PR Reviews runs `gh pr list`, `gh pr view` and `gh pr diff` (for the Changes
tab, and to pin a reviewed commit's diff) for the project's `owner/name` on the
machine that runs bb; for the sidebar, one `gh api graphql` call with one search
per section over every project's repo, and one more for the open and recently
merged pull requests of the repos it found; and `git remote get-url origin` for a
project whose remote bb did not record. On Start review and Update guide it
also runs `git fetch` in the project's default checkout, which only adds the refs under
`refs/pr-reviews/`. Its writes are `gh api --method POST` to
`repos/<owner>/<name>/pulls/<number>/comments` (a review comment, or a reply
under `…/comments/<id>/replies`) or `repos/<owner>/<name>/issues/<number>/comments`
(a conversation comment), run when you click Comment or Reply; and
`gh pr ready <number>`, `gh pr ready <number> --undo`, `gh pr close <number>`
or `gh pr reopen <number>` with `-R <owner>/<name>`, run when you choose a
change from the state pill. The diff pinned for each reviewed commit, each review run, each guide, and
when you last opened each pull request are kept in the plugin's own SQLite database (`plugins/pr-reviews/data.db` in bb's data
directory).
