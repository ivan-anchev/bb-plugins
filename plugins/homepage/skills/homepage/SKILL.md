---
name: homepage
description: Explain the Homepage plugin's cards under bb's new-thread composer. Activity is a six-month grid of the user's merged GitHub PRs with the threads they started, PRs merged and lines changed; Burn shows the Burn plugin's spend and tokens for the last week or month with the change against the period before. Use when the user asks what a homepage card shows or counts, why the Activity card is empty or out of date, why it says gh is missing or not signed in, or why the Burn card's numbers differ from Burn's page or it says Burn is missing or off.
---

# Homepage

The Homepage plugin draws a grid of cards under the composer on bb's New thread
screen. It has no commands and no settings. Its first card is Activity. When
the PR Reviews plugin is installed, its pull requests card sits beside
Activity, and the two stack when the page is narrow; that card belongs to PR
Reviews. When the Burn plugin is installed too, a narrow Burn card sits on the
second row, before boat spend when boat-sandbox is installed.

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

## Burn

### What it shows

- A Week/Month switch. Week is the last 7 days and Month the last 30, rolling,
  never the calendar week or month. It always covers every project.
- **Spent**: what the user's agents cost in that time, as Burn prices it:
  "$4.27" under ten dollars, whole dollars above ("$1,800").
- **Tokens**: tokens used in that time, such as "5.13B", "235M" or "12K".
- Beside each, the change against the same length of time just before:
  "▲ 125%" (up, in the theme's warning colour), "▼ 12%" (down), "same" when it
  rounds to 0%, or "—" when nothing was spent or used before. Hovering a
  change reads it in full, such as "▲ 125% vs previous 7 days" or "No spend in
  the previous 30 days".

### Where the numbers come from

The Homepage plugin's server calls the Burn plugin's `spend` rpc with
`{ range: "7d" | "30d", projectId: null }` and keeps `total`, `previousTotal`,
`tokens` and `previousTokens`. They match the totals on Burn's own Spend page
for the same range with no project picked. Nothing is saved; the card reads
again when it shows and every minute while it stays open.

### When it looks wrong

- "Install the Burn plugin…": Burn (id `burn`) isn't installed.
- "Burn is turned off…": enable it in Extensions, or `bb plugin enable burn`.
- "Burn is starting…" or "Burn isn't running…": check `bb plugin list` and
  `bb plugin logs burn`.
- "This version of Burn can't report spend here. Update Burn.": that Burn has
  no `spend` rpc, or refuses the input; update Burn.
- "Burn's reply changed shape…": Burn's reply no longer has the four numbers;
  update Homepage.
- "Couldn't read Burn: …": Burn's own error; `bb plugin logs burn` has more.
