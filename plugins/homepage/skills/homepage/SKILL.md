---
name: homepage
description: Explain the Homepage plugin's cards under bb's new-thread composer, starting with Activity, a six-month grid of the user's merged GitHub PRs with the threads they started, PRs merged and lines changed. Use when the user asks what a homepage card shows or counts, why the Activity card is empty or out of date, or why it says gh is missing or not signed in.
---

# Homepage

The Homepage plugin draws a grid of cards under the composer on bb's New thread
screen. It has no commands and no settings. Its first card is Activity. When
the PR Reviews plugin is installed, its pull requests card sits beside
Activity, and the two stack when the page is narrow; that card belongs to PR
Reviews.

## Activity

### What it shows

- A grid of the last 26 weeks: one column per week, Monday at the top, one
  square per day. A square's shade is how many of the user's PRs merged that
  day, in four steps of the theme's accent colour; an empty square means none.
  Today's square has a faint ring.
- Bottom left: threads started, PRs merged and lines changed in those 26 weeks.
  Threads are the ones the user started; subagent and forked threads are not
  counted. Lines changed are additions plus deletions.
- Bottom right: the first and last month the grid covers.
- Hovering a square, or tabbing into the grid and using the arrow keys, shows
  that day's PRs and lines.

### Where the numbers come from

PRs come from GitHub search for `is:pr is:merged author:@me`, read with the
`gh` CLI the user is signed in to. That covers every repository they author PRs
in, not only bb projects. Check it with:

```sh
gh search prs --author @me --merged --limit 5
```

The bb server refreshes the numbers when it starts and every 30 minutes after,
and saves them; the card shows the saved numbers, so a PR merged a minute ago
can take up to 30 minutes to appear.

### When it looks wrong

- "Install the GitHub CLI (gh)…": `gh` is not on the bb server's PATH.
- "Couldn't read GitHub. Check that gh is signed in.": run `gh auth status`,
  then `gh auth login` if needed. The card fills at the next refresh, or after
  a restart of the bb server.
- Numbers lag behind GitHub: wait for the next 30-minute refresh. A failed
  refresh keeps the last numbers; `bb plugin logs homepage` shows why it
  failed.
