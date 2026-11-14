---
name: mdxcn
description: Write mdxcn figures in bb chat replies. A code fence whose language is an mdxcn tag (`callout`, `steps`, `graph-kpi`, `graph-timeline`, …) renders as a framed monospace figure instead of code. Load this before writing the first mdxcn fence in a thread. It covers the fence syntax and all 46 tags with their props, body grammar, and one working example each, for callouts, quotes, steps, terminals, changelogs, annotated code, decisions, chats, env vars, API endpoints, keyboard keys, FAQs, tables, sheets, invoices, specs, matrices, comparisons, diffs, stats, KPIs, sparklines, plots, bars, slopes, meters, waffles, stacks, funnels, waterfalls, rankings, bullets, scores, heatmaps, flows, trees, timelines, gantt charts, activity grids, calendars, uptime strips, checklists, boards, timers and countdowns.
---

# mdxcn figures

## How to write a figure

The fence language is the tag, written exactly as listed below. The body has
two optional parts, in this order:

1. YAML front matter between `---` lines on the very first line of the body. These are the component's props.
2. A Markdown body after it. It is passed to the component as `children`, and each tag reads it with its own grammar (described per tag).

````
```graph-kpi
---
title: Weekly active
value: "12.4k"
label: users
data: [8, 9, 11, 10, 12, 12.4]
---
```
````

````
```callout
---
type: warning
---
Deploys freeze **Friday 17:00**.
```
````

Rules:

- **Use YAML or the body.** Most data tags accept either. If both set the same data, the YAML prop wins.
- **YAML has real types.** Numbers and `true`/`false` are numbers and booleans. Write arrays and objects as YAML (`[1, 2]`, `{ label: a, value: 3 }`, or block lists). Quote any label that looks like a number, date, or time: `"0.10"`, `"2026-12-01"`, `"14:02"`, `"12.4k"`.
- **Inner code blocks use `~~~`.** A ```` ``` ```` inside the body would close the outer fence. This applies to `annotate`, `endpoint`, and `env` (which read a code block as data) and to any code block inside a `callout`, `faq` answer, or `decision` note.
- **`terminal` is raw text,** not Markdown: command lines start with the prompt (`$ ` by default), and every other line is output.
- **Bold and italic in list items are syntax.** In most list grammars `**bold**` marks the current, chosen, or accent row and `*italic*` marks the next or rejected one. Don't use them for emphasis there.
- **List items are usually read as plain text.** Inline code and links in a list row are flattened, except where a tag says otherwise.
- **Required data.** Props marked **required** below must be set in YAML unless the body supplies the same data. A fence with no body and a missing required prop draws an empty `· · ·` frame. Three are needed even with a body, so always set them in YAML: `changelog` `version`, `graph-slope` `fromLabel`/`toLabel`, and `graph-calendar` `year`/`month`.
- `row` (side-by-side layout) and the bare `Graph` frame are not available as fences.

Shared props, which are not repeated per tag:

| Prop | Type | Where |
| --- | --- | --- |
| `title` | string | All tags. Drawn uppercase on the top edge. Defaults are noted per tag; otherwise there is no title. |
| `frame` | `box` (default) \| `corners` \| `rule` \| `none` | All tags |
| `corner` | string, default `+` | All tags. The glyph at the frame corners. |
| `palette` | `mono` (default) \| `duo` \| `multi` | All except `callout`, `quote`, `steps`, `terminal`, `graph-table`, `graph-sheet`, `graph-invoice`, `graph-spec`, `graph-stat`, `graph-tree` |
| `glyphs` | `shade` \| `ascii` \| `hash` \| `bar`, or a list of glyph strings | Glyph-drawn graphs: spark, kpi, plot, bars, cells, meter, waffle, stack, funnel, waterfall, rank, bullet, score, heatmap, activity, gantt, uptime |

## When to use one

- Use a figure when it reads faster than the prose or plain table it replaces: a status, a trend, a comparison, a sequence, a decision.
- Use one or two per reply, where they carry the point. Figures are not decoration.
- Don't use figures when explaining code edits. Diffs, file paths, and code stay as ordinary Markdown.
- Pick the most specific tag. Use `graph-timeline` for dated events, `graph-check` for a task list, and `graph-table` only when nothing narrower fits.

## Catalog

### Docs blocks

### callout

An aside between paragraphs: a note, tip, warning, or danger.

- `type`: `note` (default) \| `tip` \| `warning` \| `danger`. Sets the glyph and the default title.
- Body: any Markdown (paragraphs, lists, inline code, links).

````
```callout
---
type: tip
---
Run `npm run check` before pushing; CI runs the same steps.
```
````

### quote

A pull quote with attribution. No title by default.

- `by`: string, the speaker. `source`: string, muted, after the name.
- Body: the quote, as Markdown.

````
```quote
---
by: Paul Graham
source: Taste for Makers
---
A thousand barely audible voices all singing in tune.
```
````

### steps

A numbered procedure, for install guides and runbooks.

- Body: an ordered or unordered list, one item per step.
  - Tight item: `1. Title — body text`. The body becomes plain text.
  - Loose item (blank lines between items): the first paragraph is the title, and later paragraphs are the body with their formatting kept. Code blocks and nested lists in a step are dropped.
  - Bold anywhere in a step makes it the current step. Italic makes it a next step. Otherwise the step is done.

````
```steps
---
title: Release
---
1. Bump the version — Edit package.json.
2. **Tag it** — Run npm run release.
3. *Push the tag* — Pushing is a separate, deliberate step.
```
````

### terminal

A shell session. Default title `shell`.

- `prompt`: string, default `$`.
- Body: raw text. `$ cmd` is a command, `# …` is a comment, lines starting with `✓` are success lines, and anything else is output.

````
```terminal
$ npm run check
# manifests, typecheck, tests, build
✓ 5 plugins built
$ git push origin main
```
````

### changelog

One release's changes.

- `version`: string, **required**; it becomes the title unless `title` is set. `date`: string.
- Body: a list of `- type: text`. The type is `added`/`add`/`+`, `changed`/`change`/`~`, `fixed`/`fix`/`*`, or `removed`/`remove`/`-`. A row without a type counts as changed. Rows are plain text.

````
```changelog
---
version: "v0.4.0"
date: Nov 13
---
- added: Board and Score graphs
- fixed: Timeline notes no longer clip
- removed: The legacy chart tag
```
````

### annotate

Code with numbered notes. Marked lines stay bright and the rest recede. The title defaults to the code block's language, else `code`.

- Body: a `~~~lang` code block whose lines end with markers like `// (1)`, `# (2)`, `-- (3)`, or `<!-- (4) -->`, followed by an ordered list. Item 1 explains marker (1).
- YAML instead: `code` (string) and `notes` (list of strings).

````
```annotate
~~~ts
const app = createApp() // (1)
app.listen(3000) // (2)
~~~

1. Builds the app with no side effects.
2. Binds the port. Reads `PORT` in production.
```
````

### decision

One decision, the options weighed, and what follows. Default title `decision`.

- `status`: any word (`proposed`, `accepted`, …). `date`: string.
- Body: a list of options written `Option — reason`. Bold is chosen, italic is rejected, and plain is open. Paragraphs after the list are drawn below as the consequences.
- YAML instead: `options: [{ label, reason, state: chosen|open|rejected }]`.

````
```decision
---
title: Database
status: accepted
date: Mar 12
---
- **Postgres** — boring, and we already run it
- *Mongo* — no joins we trust
- SQLite — fine until the second writer

Revisit if writes pass 2k/s.
```
````

### chat

A short conversation transcript. Default title `chat`.

- `you`: string, the asker, whose turns get the prompt. Defaults to the first speaker. `prompt`: string, default `>`.
- Body: a list of `- speaker: text` (speaker up to 24 characters). Inline Markdown is kept. A turn that is only italic is an aside (a tool call, a pause).
- YAML instead: `turns: [{ by, children, aside }]`.

````
```chat
- you: which graph shows a rollback?
- agent: Timeline. Bold the rollback row.
- agent: *reads graph-timeline.tsx*
```
````

### env

Environment variables with defaults and notes. Default title `.env`.

- Body, either:
  - A `~~~bash` block in `.env` form. Comments above a key become its note, and a comment containing `required` marks the key required.
  - A list `- KEY: value — note`, where a bold key is required.
- YAML instead: `vars: [{ name, value, note, required }]`.

````
```env
~~~bash
# Postgres connection string. Required.
DATABASE_URL=postgres://localhost:5432/app

# Leave empty to turn analytics off
ANALYTICS_ID=
~~~
```
````

### endpoint

One API route: method, path, params, and request/response bodies. Default title `endpoint`.

- Body, in order:
  1. A paragraph `METHOD /path`.
  2. Paragraphs describing the route.
  3. A table of params with columns name, type, description. A bold name is required, and the header row is skipped.
  4. `~~~lang` code blocks. A block starting with `$ ` or `curl` is labeled `request`; other blocks are labeled with their language.
- YAML instead: `method`, `path`, `params: [{ name, type, description, required }]`, `blocks: [{ label, code }]`.

````
```endpoint
POST /v1/graphs

Draws a graph from props and returns the ASCII.

| Field | Type | Description |
| --- | --- | --- |
| **slug** | string | Tag name, e.g. `graph-table` |
| props | object | Same shape as the YAML props |

~~~json
{ "ascii": "+--- [ NIGHT ] ---+" }
~~~
```
````

### keys

Keyboard shortcuts. Default title `keys`.

- Body: a list of `- keys: action`. Keys can be `⌘K`, `Ctrl+Shift+P`, or a sequence like `g then d`. A bold row is accented.
- YAML instead: `bindings: [{ keys, action, accent }]`.

````
```keys
---
title: Shortcuts
---
- ⌘K: search
- Ctrl+Shift+P: command palette
- g then d: go to docs
```
````

### faq

Questions and answers. Default title `faq`.

- Body: a `### Question` heading followed by its answer (any Markdown), repeated. A bold question is accented.
- YAML instead: `entries: [{ question, answer, accent }]`.

````
```faq
### Is this an npm package?

No. The CLI copies the source into your repo.

### Does it need MDX?

No. Plain Markdown works.
```
````

### Data

### graph-table

A generic table. Use it only when no narrower tag fits.

- `headers`, `rows` (**required**), `footer`, `align`.
  - `rows` is a list of cell lists.
  - `align` is a list or space-separated string of `left`/`right`. The default is a left-aligned first column and right-aligned others.
- Body: a Markdown table. If the last row's first cell is bold or says `Total`, that row becomes the footer, drawn under a rule.

````
```graph-table
---
title: Bundle size
---
| Package | Before | After |
| --- | --- | --- |
| core | 42 kb | 31 kb |
| ui | 18 kb | 19 kb |
| **Total** | 60 kb | 50 kb |
```
````

### graph-sheet

A table split into titled sections that share one header.

- `headers`, `sections` (**required**), `footer`, `align`.
  - `sections` is a list of `{ title, rows: [[cells]] }`.
  - `footer` can only be set in YAML.
- Body: a `### Section` heading followed by a Markdown table, repeated. Every table needs a header row, but only the first one is shown. A bold or `Total` last row is dropped, so put totals in YAML `footer`.

````
```graph-sheet
---
title: Q4 plan
---
### Scope
| Item | Owner | Status |
| --- | --- | --- |
| CLI copies files | priya | done |
| Registry JSON | sam | open |

### Docs
| Item | Owner | Status |
| --- | --- | --- |
| Usage guide | lee | open |
```
````

### graph-invoice

An invoice or quote: parties, meta, line items, totals.

- `items`: **required**, a list of `{ description, qty, rate, amount }`. Only `description` and `amount` are needed.
- `from`, `to`: a string (newlines split it into name and lines) or `{ name, lines: [..] }`.
- `meta`: a list of `{ label, value }`. `totals`: a list of `{ label, value, accent }`. `note`: string.
- Body, if you use one:
  - `- Label: value` list items become meta.
  - A table becomes the items. Columns are matched by the headers `qty`, `rate`/`price`, and `amount`/`total`.
  - A paragraph ending in a bare number (`Subtotal 3,200`) becomes a total, and bold makes it accented. Don't put currency symbols on totals.
  - The first other paragraph is the note. It must not end in a number.
- YAML is the safer form.

````
```graph-invoice
---
title: Invoice 042
from:
  name: North Studio
  lines: ["12 Harbour St", "Leith"]
to: Acme Ltd
meta:
  - { label: Issued, value: "Nov 1" }
  - { label: Due, value: "Dec 1" }
items:
  - { description: Design, qty: "10", rate: "120", amount: "1,200" }
  - { description: Build, qty: "20", rate: "100", amount: "2,000" }
totals:
  - { label: Subtotal, value: "3,200" }
  - { label: Total, value: "3,200", accent: true }
note: Net 30.
---
```
````

### graph-spec

Label/value pairs, a spec sheet. Use it for a config summary or the facts about one thing.

- `rows`: **required**. A list of `{ label, value, accent, note }`.
- Body: a list of `- Label: value`. Inline code and links in the value are kept, and a bold row is accented. In a loose item, the paragraphs after the first become a muted note.

````
```graph-spec
---
title: Runtime
---
- Node: `22.x`
- Package manager: npm workspaces
- **Deploy target: Fly.io**
```
````

### graph-matrix

A labeled grid of numbers, such as a confusion matrix or a counts cross-tab.

- `columns`: **required**, a list (or a space-separated string for one-word names).
- `rows`: **required**, a list of `{ label, values: [..] }`.
- `accent`: a row label to highlight; the other rows dim.
- Body: a Markdown table. **Leave the first header cell empty**: with any text there, it is counted as a data column and the columns shift.

````
```graph-matrix
---
title: Classifier
columns: [Pred pos, Pred neg]
rows:
  - { label: Actual pos, values: [41, 3] }
  - { label: Actual neg, values: [5, 51] }
accent: Actual pos
---
```
````

### graph-compare

A feature comparison across options, drawn with ✓ and –.

- `columns`, `rows`: **required**. `rows` is a list of `{ label, values: [..] }`, where each value is `true`/`false` or a string.
- `accent`: a column name to focus; the other columns dim.
- Body: a Markdown table with an **empty first header cell**. The cells `yes`/`true`/`✓`/`x` become ✓, and `no`/`false`/`-`/`–` become –. Other text shows as written.

````
```graph-compare
---
title: Plans
accent: Studio
---
| | Solo | Studio |
| --- | --- | --- |
| Registry | yes | yes |
| Seats | 1 | 10 |
| SSO | no | yes |
```
````

### graph-diff

Before/after deltas per line: bundle sizes, dependency or config changes.

- `rows`: **required**. A list of `{ label, value, sign: add|remove|keep }`. `footer` takes the same shape and is drawn under a rule.
- Body: a list of `- label: +value` (add), `- label: -value` (remove), or `- label: value` (keep). A bold row becomes the total. Strike through text to show a rename: `- config: ~~old~~ new` draws a removed line and an added line.

````
```graph-diff
---
title: Bundle
---
- app: +31 kb
- vendor: -12 kb
- polyfills: 8 kb
- config: ~~next.config.js~~ next.config.ts
- **total**: +19 kb
```
````

### graph-stat

A row of headline numbers, up to four per row.

- `items`: **required**. A list of `{ value, label, hint, accent }`.
- Body: a list of `- value label — hint`. The value is the first word, and a bold row is accented.

````
```graph-stat
- **12,400** docs — +18% this week
- 860 shipped
- 3 incidents — all resolved
```
````

### graph-kpi

One big number with a label, a hint, and a sparkline under it.

- `value`, `label`, `data`: **required**. `data` is a list of numbers or a space-separated string.
- `hint`: string.
- Body: a first paragraph `value label — hint`, then a blank line, then a paragraph of numbers.

````
```graph-kpi
---
title: Weekly active
value: "12.4k"
label: users
hint: +18% vs last week
data: [8, 9, 11, 10, 12, 12.4]
---
```
````

### Charts

### graph-spark

A one-line sparkline, for a trend at a glance.

- `data`: **required**. A list or space-separated string, scaled to the max.
- `caption`: string.
- Body: `2 3 5 8 — caption`, or a list of `- Mon: 4` rows.

````
```graph-spark
---
title: Deploys
---
2 3 5 8 13 9 11 — deploys per day
```
````

### graph-plot

An area or line chart of one series.

- `data`: **required**. `labels`: a list; the first and last are shown on the axis.
- `variant`: `area` (default) or `line`. `height`: rows, default 7. `progress`: 0–1, how much of the series to reveal.
- Body: numbers, or a list of `- label: value` (labels kept).

````
```graph-plot
---
title: p95 latency (ms)
variant: line
data: [120, 132, 128, 160, 210, 180, 150]
labels: [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
---
```
````

### graph-bars

Two small bar series side by side with an arrow between them (before → after).

- `from`, `to`: **required**. Each is `{ label, values: [..], size: sm|lg }`.
- `processor`: text drawn between the arrows.
- Body: two list items `- label: 2 4 3 5`. The first is `from` and the second is `to`, and a bold item is drawn taller.
- Each side scales to its own max, so the chart compares shape, not magnitude. Use `graph-slope` or `graph-diff` to compare amounts.

````
```graph-bars
---
title: Build time
processor: cache
---
- before: 8 9 7 10 9
- after: 3 4 3 4 3
```
````

### graph-slope

Each row's change between two points (Q1 → Q2).

- `fromLabel`, `toLabel`: **required** strings, the column heads. Always set them in YAML.
- `items`: a list of `{ label, from, to }`.
- Body: a list of `- label: 8,200 → 12,400`. The arrow can be `→`, `->`, or `=>`.

````
```graph-slope
---
title: Weekly reads
fromLabel: Q1
toLabel: Q2
---
- docs: 8,200 → 12,400
- blog: 3,100 → 2,600
```
````

### graph-cells

Small labeled grids of on/off cells, for occupancy, fragmentation, or before/after layouts.

- `items`: **required**. A list of `{ label, cells: [[1, 0, …], …] }`, where `1` is filled and anything else is empty.
- Body: a list of `- label: 1 0 1 / 0 1 0`, with `/` separating rows.

````
```graph-cells
---
title: Fragmentation
---
- before: 1 0 1 0 1 / 0 1 0 1 0
- after: 1 1 1 0 0 / 1 1 0 0 0
```
````

### graph-meter

A single gauge for one ratio: disk, quota, coverage.

- `value`: **required**. `0.67`, `"67%"`, or `"0.67"`.
- `caption`: string. `ticks`: default 14.
- Body: `67% — of the disk`.

````
```graph-meter
---
title: Disk
---
67% — of 500 GB used
```
````

### graph-waffle

A share shown as a grid of cells out of 100.

- `value`: **required** (`0.73` or `"73%"`). `caption`: string.
- `cells`: default 100. `columns`: default 10.
- Body: `73% — tests green`.

````
```graph-waffle
---
title: Test suite
---
73% — tests green
```
````

### graph-stack

Stacked bars showing each row's split into parts.

- `rows`: **required**. A list of `{ label, segments: [{ label, value }] }`.
- `accent`: a segment label to highlight (default: the first segment). `ticks`: bar width, default 24.
- Body: a list of `- row: 48 js 30 css 22 html`, as value/label pairs. Segment labels are one word.

````
```graph-stack
---
title: Bundle by language
---
- marketing: 48 js 30 css 22 html
- docs: 20 js 50 css 30 html
```
````

### graph-funnel

Drop-off through ordered stages.

- `steps`: **required**. A list of `{ label, value, display }`.
- `stage`: a step label to focus; the others dim. `ticks`: default 20.
- Body: a list of `- 12,400 visited`. The number comes first and is shown as written.

````
```graph-funnel
---
title: Signup
---
- 12,400 visited
- 3,100 signed up
- 860 paid
```
````

### graph-waterfall

A running total moved by gains and losses.

- `items`: **required**. A list of `{ label, value, display, kind: start|in|out|end }`.
  - Without `kind`, the first row is the start, the last row is the end, and the rows between are in or out by sign.
  - The end value is drawn as given, not computed, so make it the real total.
- `ticks`: default 24.
- Body: a list of `- label: value`, with negatives as `-6`.

````
```graph-waterfall
---
title: MRR (k)
---
- Start: 120
- New: 18
- Churn: -6
- End: 132
```
````

### graph-rank

A ranked horizontal bar list: top pages, slowest queries.

- `items`: **required**. A list of `{ label, value, display }`.
- `max`: the scale; defaults to the largest value. `ticks`: default 20.
- Body: a list of `- 12,400 /docs`. The number comes first and is shown as written.

````
```graph-rank
---
title: Top pages
---
- 12,400 /docs
- 4,100 /install
- 980 /blog
```
````

### graph-bullet

Actual against target, per row.

- `items`: **required**. A list of `{ label, value, target, max, display }`. Without `max`, the scale is the larger of value and target.
- `ticks`: default 20.
- Body: a list of `- label: value / target of max`. Both `/ target` and `of max` are optional.

````
```graph-bullet
---
title: Capacity
---
- CPU: 72 / 80 of 100
- Memory: 61 / 70 of 100
```
````

### graph-score

Ratings drawn as dots, with halves allowed.

- `items`: **required**. A list of `{ label, value, max, accent }`.
- `max`: dots per row. It defaults to the first `/n` written, else 5.
- Body: a list of `- label: 4/5`. A bold row is accented.

````
```graph-score
---
title: Review
---
- Performance: 4/5
- Accessibility: 5/5
- **Docs: 2.5/5**
```
````

### graph-heatmap

Intensity over a labeled grid, such as hour × day.

- `columns`, `rows`: **required**. `rows` is a list of `{ label, values: [numbers] }`.
- `max`: the scale; defaults to the peak. `legend`: default `true`. `caption`: string.
- Body: a Markdown table with an **empty first header cell**.

````
```graph-heatmap
---
title: Deploys by hour
columns: ["00", "06", "12", "18"]
rows:
  - { label: Mon, values: [0, 2, 8, 3] }
  - { label: Tue, values: [1, 4, 9, 2] }
---
```
````

### graph-flow

A pipeline or process as boxes and arrows, one row per path.

- `rows`: **required**. A list of `{ nodes: [{ label, tone: default|accent|muted }] }`.
- Body: one paragraph per row, with nodes split on `→`, `->`, or `=>`. Separate rows with a blank line, or write a list. A bold node is accented and an italic node recedes.

````
```graph-flow
---
title: Publish
---
write → review → **ship**

review → *revise* → review
```
````

### graph-tree

A hierarchy: a file tree, an org chart, a module layout.

- `nodes`: **required**. A list of `{ label, meta, accent, children: [...] }`.
- Body: a nested list of `- name — meta`. A bold item is accented, and so are its ancestors. A single root draws without a branch.

````
```graph-tree
- src
  - graph-frame.tsx — ui
  - **graph-table.tsx** — new
  - adapters.ts
```
````

### Time & progress

### graph-timeline

Dated events in order: an incident, a launch, a history.

- `events`: **required**. A list of `{ date, label, state: done|now|next, note }`.
- Body: a list of `- date: label — note`. Bold is now, italic is next, and plain is done. In a loose item, the paragraphs after the first become the note.

````
```graph-timeline
---
title: Incident 214
---
- 14:02: p95 crossed 800 ms
- 14:09: Rolled back — v2.3.1
- **14:15: Error rate normal**
- *15:00: Postmortem*
```
````

### graph-gantt

Spans on a shared 0–1 track, for a schedule or phases.

- `items`: **required**. A list of `{ label, start, end, complete, accent }`. All values are fractions from 0 to 1, and `complete` is the done share of the span.
- `ticks`: a list of axis labels. `columns`: default 24. `stage`: a label to focus. `progress`: 0–1, a playhead.
- Body: a list of `- label: start end complete`. A bold row is accented.

````
```graph-gantt
---
title: Q4
ticks: [Oct, Nov, Dec]
---
- design: 0 0.3 1
- **build**: 0.2 0.8 0.5
- launch: 0.8 1
```
````

### graph-activity

A GitHub-style daily contribution grid.

- `days`: **required**. A list of `{ date: "YYYY-MM-DD", count }`.
- `weekStartsOn`: `0` (Sunday, default) or `1`. `max`. `legend`: default `true`.
- `caption`: a string, or `false` to hide it. It defaults to "N contributions".
- Body: a list of `- YYYY-MM-DD: 0 1 4 2`, with counts running day by day from that date. A run like `0*5` means five zeros.

````
```graph-activity
---
title: Commits
---
- 2026-10-05: 0 1 4 2 0*5 3 6 1
- 2026-10-19: 2 0 0 5 8 1 0
```
````

### graph-calendar

One month with marked days. The title defaults to "Month Year".

- `year`, `month` (1–12): **required**, always in YAML.
- `weekStartsOn`: `1` (Monday, default) or `0`. `today`: a day number.
- `marks`: `[12, 18]` or a list of `{ day, accent, label }`.
- Body: a list of `- 12: label`. Labels are listed under the month, and a bold day is today.

````
```graph-calendar
---
year: 2026
month: 11
---
- 3: kickoff
- **13**: review
- 28: launch
```
````

### graph-uptime

A daily status strip with an uptime percent.

- `days`: **required**. A list or a space-separated string of `ok`, `degraded`, `down`, `empty`. Runs like `ok*40` repeat a status.
- `from`, `to`: edge labels. `columns`: days per row, default 30.
- Body: the same status words.

````
```graph-uptime
---
title: API, 90 days
from: Aug 15
to: Nov 13
days: "ok*40 degraded ok*20 down*2 ok*27"
---
```
````

### graph-check

A checklist with nested subtasks.

- `items`: **required**. A list of `{ label, done, note, items: [...] }`.
- Body: a task list `- [x] label — note`. A nested list becomes subtasks.

````
```graph-check
---
title: Release
---
- [x] Freeze tokens
- [x] Ship registry JSON — v0.4
- [ ] Docs
  - [x] Usage guide
  - [ ] API reference
```
````

### graph-board

Kanban columns, up to four.

- `columns`: **required**. A list of `{ title, items: [string | { label, note, state: done|now|next }] }`.
- Body: a `### Column` heading followed by a list, repeated. Write items as `label — note`. Bold is now, italic is next.

````
```graph-board
---
title: Roadmap
---
### Now
- **Children for every graph**

### Next
- Board — this drop

### Later
- *Figma kit*
```
````

### graph-timer

A live clock that ticks every second.

- `kind`: `elapsed` (default, HH:MM:SS since `at`), `ago` (`5m ago`), or `clock` (local time; `at` is ignored).
- `at`: a quoted ISO instant. `caption`: string.
- Body: `2026-11-13T09:00:00Z — caption`.

````
```graph-timer
---
title: Since deploy
---
2026-11-13T09:00:00Z — v2.4 live
```
````

### graph-countdown

A live countdown to an instant.

- `to`: **required**, a quoted ISO date or instant.
- `done`: text shown once the time passes, default `done`. `caption`: string.
- Body: `2026-12-01 — caption`.

````
```graph-countdown
---
title: Launch
to: "2026-12-01T09:00:00Z"
caption: until GA
---
```
````
