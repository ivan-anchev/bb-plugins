# bb-plugin-homepage

A `homepageSection` under the new-thread composer that lays out a grid of cards
(`HomeSection.tsx`, `homepage.css`). Each card lives in its own folder with its
UI, its server-side data, and its tests, and adds one read to `contract.ts`. A
card that needs the full row sets `grid-column: 1 / -1`.

bb draws every homepage section's title as an `<h2>`; `homepage.css` hides it by
the section's id, because each card carries its own header.

## Cards

### Activity (`activity/`)

Six months of the gh user's merged PRs as a calendar grid, with threads
started, PRs merged and lines changed below it.

- `server.ts` keeps its snapshot in plugin KV storage. A background service builds
  it on load and a cron refreshes it every 30 minutes; the `activity` RPC returns
  the saved snapshot, so the card never waits on GitHub. Each refresh invalidates
  the RPC's tag, which re-reads open cards.
- `activity/github.ts` runs `gh api graphql --paginate --slurp` over a search for
  `is:pr is:merged author:@me`. Lines changed are additions plus deletions.
- `activity/threads.ts` pages the server's thread list (root threads, active and
  archived) for start times.
- A failed GitHub read keeps the last good PRs. With none saved, the card
  shows why (gh missing, or not signed in).

### Activity: design decisions

Chosen from a prototype round on the new-thread screen (November 2026):

- A calendar grid ("Ledger"), not a 30-day bar strip ("Pulse") or a
  weekday × hour punchcard ("Rhythm"). The grid gives the long view at a glance.
- Merged GitHub PRs, not threads started: threads only go back a few weeks, so
  a thread grid was mostly empty.
- Six months, 26 columns stretched to the composer's width, not a full year of
  fixed 11px cells.
- Shades come from `--timeline-accent`, the theme's accent, in four quartile
  steps over non-zero days, so a single huge day doesn't wash out the rest.
- The card shows the last saved snapshot and refreshes in the background.
  Reading GitHub live took about 15 s per open, and a single aliased query
  saved only about 1 s.

## Develop

```sh
bb plugin install ./plugins/homepage   # once
bb plugin dev plugins/homepage         # rebuild and reload on save
npm test --workspace plugins/homepage
```
