# bb-plugin-homepage

Cards under the new-thread composer. Each card is its own `homepageSection`,
lives in its own folder with its UI, its server-side data, and its tests, adds
one read to `contract.ts`, and wears the shared `.hp-card` chrome from
`homepage.css`.

bb draws every homepage section's title as an `<h2>`; `homepage.css` hides it by
the section's id, because each card carries its own header.

## Layout

bb stacks every plugin's homepage section in one parent. When PR Reviews'
`pull-requests` card is on the page too, `homepage.css` turns that parent
into wrapping rows of cards:

1. Activity and PR Reviews, half each.
2. Burn's narrow column (`--hp-narrow`: 30% of the row, 280–340px; 312px on
   a full row), then boat-sandbox's `spend` card taking the width left.

Every other section keeps a full row after them. Section ids are
`plugin-homepage:<plugin id>:<section id>`; the rule selects the parent with
`:has()` on those ids and never names bb's classes. Without PR Reviews nothing
changes.

It is flex, not grid, because the rows split differently (halves, then wide
and narrow) and a missing section must leave no empty cell. Each placed
section is a one-cell grid, so its card stretches to its row's height: Burn
is as tall as boat spend beside it, which takes the top row's height.

The rows are wider than the composer: up to 1040px, centred under it with a
16px gutter each side of bb's page, sized with `cqw` against the page's size
container (bb caps the composer's column at 760px). Every card takes a full
row when the page is narrower than 592px.

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

### Burn (`burn/`)

Spend and tokens from the [Burn](https://github.com/kalindudc/burn) plugin
(id `burn`) over its rolling 7 or 30 days, picked with a Week/Month switch,
each with its change against the same length of time before.

- The app's rpc hooks call only their own plugin, so the `burnSpend` rpc
  proxies to Burn's `spend` through `bb.sdk.plugins.callRpc`, with
  `projectId: null` (every project). It parses only `total`, `previousTotal`,
  `tokens` and `previousTokens` (`burnTotalsSchema`); Burn is 0.x and the rest
  of its reply can change.
- Nothing is cached here: Burn keeps its own numbers. The card loads both
  ranges at once, reads the one on show again when it comes into view and
  every minute while the page is visible.
- `burn/spend.ts` turns a failed call into one line: Burn not installed
  (404 `unknown plugin`), turned off or starting (503 `not running`), too
  old or too new for the request (`unknown_method`, `invalid_input`), a reply
  missing the four numbers (Zod), or anything else, clipped.
- `burn/format.ts` holds the money, token and change rules; `BurnCard.tsx`
  is the card alone, given a view (loading, ready, unavailable).

### Burn: design decisions

Chosen from a prototype round (November 2026), the "Vertical" design:

- Two metrics, Spent over Tokens, at the card's foot, with no divider.
  Each value has its change on the same baseline.
- The change is Burn's Spend page's (`extensions/bb/spend/usage.tsx`,
  `Change`) without "vs previous 7 days": the switch names the period. The
  full sentence is the change's tooltip and its screen-reader text.
- Turned down: daily bars, a cumulative pace line, a per-project table or
  switch, captions and footers (date ranges, thread counts, cache %, top
  thread), metrics side by side, and the change on its own line.

## Develop

```sh
bb plugin install ./plugins/homepage   # once
bb plugin dev plugins/homepage         # rebuild and reload on save
npm test --workspace plugins/homepage
```
