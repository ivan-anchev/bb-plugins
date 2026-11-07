PR Reviews adds a **PR Reviews** app to bb's left rail. It lists a GitHub
project's open pull requests and opens each one as a guided review, written by
a review thread, that walks you through the change step by step. Nothing is
ever posted to GitHub.

## What you get

- **Your GitHub projects**: the sidebar's picker lists the bb projects whose
  git remote is on github.com, and remembers the one you chose last.
- **Open pull requests**: each row shows the PR's number, title, author, when
  it was last updated, and its review state in words.
- **A page per pull request**: its title, author, `branch → base`, and quiet
  Open thread and GitHub buttons, above its guide.
- **Start review**: starts a review thread in a new worktree, with your
  Review instructions from Settings → PR Reviews. The page shows it writing,
  with the time so far, Open thread and Cancel, and asks it to finish if it
  stops without a guide.
- **A checked guide**: the thread hands in its guide with the `submit_review`
  tool, which only review threads get. PR Reviews rejects a guide that leaves
  out a hunk of the diff, lists one twice, or has more than 7 steps, and says
  exactly what to fix. The row then reads Guide ready, and the rail badge
  counts the ready guides.
- **What this PR does**: the guide opens on an overview: the author's own
  description on demand, the problem and the approach, before and after when
  behaviour changes, what the guide leaves out and why, and who wrote it.
- **One step at a time**: Start the walkthrough shows each step's
  explanation, any decision left to you, and its code in bb's own diff view,
  the same one Code Explorer uses. Move with ← and → (or J and K); each
  arrow's tooltip names the step it leads to, and Next on the last step
  returns to the overview.
- **Errors beside your data**: if GitHub can't be read, the error shows above
  the list you already had. Refresh, or click the open PR again, to retry.

## How it works

PR Reviews reads pull requests with the GitHub CLI (`gh`) on the machine that
runs bb, so `gh` must be installed and signed in there. It only reads: it
never comments, approves, or changes anything on GitHub. Review threads never
reach GitHub at all: before one starts, PR Reviews fetches the PR's commits
into the project's repository with `git fetch`, and the thread reads them
there. So Start review needs the project's default checkout on the machine
that runs bb.
