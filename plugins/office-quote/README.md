# bb-plugin-office-quote

A daily The Office quote above the new-thread composer.

## Placement

bb's only homepage slot, `homepageSection`, draws under the composer. The plugin
registers one section (`quote`), hides it by its id
(`plugin-homepage:office-quote:quote`), and `AboveComposer` portals the quote into
a node it prepends to bb's page column, the parent whose first child is the
composer. The composer and every section below shift down. The node is added and
removed with the section, so it exists only while the homepage is open.

It depends on bb's DOM: section → stack of sections → page column. When that
changes, `pageColumn` throws a message naming the cause instead of drawing in the
wrong place.

## Daily quote (`quote/`)

`daily-quote.ts` saves `{ day, quote }` in the plugin's KV, with the day as the
server's local `YYYY-MM-DD`. Each read first replaces the quote if its day is
not today; overlapping checks share one fetch. A cron at 00:00 runs the same
check and invalidates the `quote` RPC tag, so an open homepage changes at
midnight. A failed fetch keeps the old quote and retries on the next read.

`office-api.ts` reads `https://officeapi.akashrajpurohit.com/quote/random` and
parses its wire shape into `Quote`. The API rate-limits hard (Cloudflare 1015
after a few dozen quick requests), which is why the server fetches once a day
rather than per visit.

## Design

Decided from a three-round prototype on bb's real homepage, 2026-11-14:

- Direction: a centred headline in bb's own sans, the speaker's face and name
  under it.
- Quote: 22px / 1.3, weight 500, -0.015em, max 32ch, `text-wrap: balance`.
  Quotes over 90 characters: 18px / 1.4, -0.01em, max 44ch.
- No quotation marks, no refresh button. One quote a day.
- 48px between the quote and the composer; 14px between quote and attribution.
- Attribution: 20px round avatar (initials when the image fails), 13px muted name.
- Entrance: 220ms fade and 4px rise, `cubic-bezier(0.32, 0.72, 0, 1)`; none with
  reduced motion.
- Rejected: a muted single line (easy to stop noticing); a card like Activity
  (too much of a widget for a joke); a speech bubble (avatar quality varies by
  host); a serif headline (the user disliked the font); a left-aligned pull quote
  (off-balance over the centred composer); a muted "ambient" headline (hard to
  read on a near-black theme); a monospace screenplay version (liked, but the
  sans reads as part of bb).

## Development

```sh
npm run typecheck
npm test
bb plugin install ./plugins/office-quote   # once, from the repo root
bb plugin dev plugins/office-quote
```
