---
name: pr-reviews
description: What the PR Reviews plugin's left-rail app shows (a GitHub project's open pull requests in a sidebar, and a page per pull request), where its data comes from (the GitHub CLI), and how to point a user at it.
---

# PR Reviews

The PR Reviews plugin adds a **PR Reviews** entry to bb's left rail. It has no
CLI command, no agent tool, and no settings yet.

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
  long ago the PR was last updated, and its review state. Every PR currently
  reads **No guide**.

## The page

Clicking a row opens that PR's page. Its header shows `#number` and the title,
the author, `head-branch → base-branch`, and a **GitHub** link that opens the
PR on github.com. Below it, a PR without a guide shows **No guide yet**.

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

PR Reviews runs `gh pr list` and `gh pr view` for the project's `owner/name`
on the machine that runs bb, and `git remote get-url origin` for a project
whose remote bb did not record. It only reads; it never writes to GitHub.
