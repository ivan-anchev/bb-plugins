PR Reviews adds a **PR Reviews** app to bb's left rail. It opens in the main
pane, keeps bb's thread sidebar visible, and lists your pull requests across
every GitHub project, in Authored by me, Needs my review and Recently merged,
with stacked pull requests as trees, and opens each one on a page with its
whole diff in a file tree and a guided review, written by a review thread, that walks you
through the change step by step. Its Summary shows the PR's activity, as
GitHub's Conversation tab does, and every diff shows the PR's GitHub review
threads where they belong. It posts to GitHub only the review comments,
replies and conversation comments you write or pick from the guide, on your
click, on a PR you didn't write batches them into a pending review you submit
as a comment, approval or request for changes, or submits one with no comments,
and changes or merges a pull
request only from the state badge and the Merge button on its page; review
threads never post to GitHub. A card on the new-thread screen shows the PRs waiting on your review,
or your own.

## What you get

- **Your PRs on the new-thread screen**: a card under the composer with the
  first three PRs of Needs my review, and how many it lists in all. Click its
  title to switch to Authored by me or Recently merged. Each row is the
  title and a badge of the PR's number coloured by its state (open, draft,
  merged, closed), over the repository, the author's avatar with the sidebar's
  attention dot, the author's name, and the age. Click one to open its page. With the Homepage
  plugin installed, the card sits beside its Activity card.
- **Your pull requests, everywhere**: one list inside the main pane for every
  bb project whose git remote is on github.com, no picker. **Authored by me** (open, and closed
  in the last 7 days), **Needs my review** (review requested from you or your
  team) and **Recently merged** (yours or reviewed by you, last 7 days), each
  with its count and a quiet line when empty. A header above the list holds
  chips (All, Mine, Review, Merged) that list one section, and a Filter that
  hides the sections you don't watch; clicking a section's heading folds it.
  The list sits beside the selected review in wide panes. In narrow panes,
  opening a PR shows its review; **Pull requests** above it returns to the
  list.
- **Compact rows**: one line each, the author's avatar, the title, and a
  badge with the PR's state icon and number, coloured by state. The repo's name shows on hover,
  focus and the open row. At most one dot on the avatar asks for attention:
  CI failing, else changes requested, else new activity since you last opened
  it.
- **Stacks as trees**: pull requests built on each other show under "Stack
  #N" (the bottom one) with "3 of 5", bottom first; the stack's pull requests
  listed elsewhere stay in place as dim rows.
- **A page per pull request**: a header bar drawn as bb's own pane headers,
  with a state badge for whether it is open, a draft, merged or closed,
  `owner/repo #number`, and Review chat and GitHub icon buttons, above its
  title, author and `base ← branch`, then three tabs in one segmented control:
  **Summary**, the author's own
  description and the PR's activity beside its reviewers, checks and labels; **Changes**, the
  PR's whole diff, with its `+N −M` on the tab; and **Guide**, which keeps its
  step while you switch and marks a ready guide with a dot.
- **Change the state in place**: the badge's menu offers what GitHub allows,
  Ready for review, Convert to draft, Close (press and hold) or Reopen, each
  naming the state it leads to, and runs it through `gh` as you. The badge and
  the sidebar row follow without a Refresh; a refusal shows in the menu.
- **Merge in place**: an open PR's header has a Merge button (press and hold),
  with a chevron that switches it to Squash and merge or Rebase and merge,
  offering only the methods the repository allows. It merges only the head the
  page shows, so new commits pushed since make GitHub refuse; a refusal shows
  under the button.
- **Activity**: under the description, the PR's whole GitHub activity, oldest
  first, as GitHub's Conversation tab shows it, starting from who opened it:
  conversation comments and reviews on the page, each review's threads as rows
  that open the Changes tab at the thread, and every commit and event between
  them a quiet one-line entry on a timeline, a run of one kind folded into one
  line, such as "Pushed 3 commits" or "marlin force-pushed 7 times", that opens
  in place. Approvals and reviews whose threads are all resolved are one line
  each. A composer at the foot comments on the PR's conversation; Quote on a
  message quotes it there.
- **Changes**: every changed file in a tree with its `+N −M`, beside every
  file's diff in one scrolling list, drawn like bb's own. Click a file to jump
  to it; the tree follows the file you read. Lockfiles and diffs over 1,000
  lines fold behind Load diff. Click "N unmodified lines" to
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
  exactly what to fix. The rail badge then counts the ready guides.
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
  in a block under its line, with Ask about this and Comment: each opens the
  comment box under it, empty to ask the thread about the finding, or with the
  finding as the comment to post on its line.
- **One comment box per diff**: hover a line and click the gutter's +, or
  drag from it, to select lines in any diff; a box drawn as bb's composer opens
  under them, for markdown with a preview, and a Send as chip whose menu picks
  Ask, Comment or Review for its one send button. Pick other lines and it moves there with your text.
- **Ask about lines**: sent as Ask, your question goes to the review thread
  with the quoted lines; the answer is in Review chat.
- **Comment on GitHub**: sent as Comment, your text posts as a review comment
  on the lines and the box links to it; nothing is posted before you send. Lines GitHub
  can't anchor to become a file comment quoting them, and the box says so, as
  it does for a comment on an older commit than the PR's latest.
- **Review mode**: on a PR you didn't write, sending as Review keeps the comment
  in your pending GitHub review, marked Pending, until you submit it. Finish
  review, at the top of every tab, submits it as a comment, an approval or a
  request for changes, with an optional summary, or discards it. With no
  pending review, Review in the same place approves, requests changes or
  comments at once, with no line comments needed.
- **GitHub's comments in place**: each review thread shows under its lines in
  the Changes tab and in the guide step that holds them, with each comment's
  author, avatar, time and markdown. File comments and outdated threads show
  at their file, outdated ones over the lines they were written on; long
  threads, bot comments and resolved threads are folded. Reply, Ask about
  this, or Quote on a comment opens the same comment box in the thread; a
  comment or reply you post shows in place.
- **New commits**: when a PR moves past its guide, the guide stays readable under "N new commits since this guide was
  written". Update guide asks the same review thread to read only the new
  commits and hand in a complete guide for the new head.
- **View options**: switches to show tests and mocks (hidden by default) and
  findings (shown by default).
- **Errors beside your data**: if GitHub can't be read, the error shows above
  the sidebar you already had. Refresh, or click the open PR again, to retry.

## How it works

PR Reviews reads pull requests with the GitHub CLI (`gh`) on the machine that
runs bb, so `gh` must be installed and signed in there. It writes to GitHub
only when you send a comment box's text as Comment or Review, or submit or discard your
review, or change or merge a PR from its page, as your `gh` account; it never approves or requests
changes unless you submit a review that does, never merges unless you hold Merge, and never edits
anything. Review threads
never reach GitHub at all: before one starts, PR Reviews fetches the PR's commits
into the project's repository with `git fetch`, and the thread reads them
there. So Start review needs the project's default checkout on the machine
that runs bb.
