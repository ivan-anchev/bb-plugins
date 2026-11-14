Agents in bb can draw [mdxcn](https://mdxcn.dev) figures right in their replies: callouts, steps, terminal sessions, tables, KPIs, small charts, timelines and more, each in mdxcn's dashed, monospaced frame. An agent writes an ordinary fenced block named after the figure, and bb shows the figure in its place.

## What you get

- **All 46 mdxcn figures.** Docs blocks (callout, quote, steps, terminal, changelog, annotate, decision, chat, env, endpoint, keys, FAQ), data (table, sheet, invoice, spec, matrix, compare, diff, stat, KPI), charts (spark, plot, bars, slope, cells, meter, waffle, stack, funnel, waterfall, rank, bullet, heatmap, activity, calendar, uptime) and time and progress (flow, tree, timeline, Gantt, check, board, score, timer, countdown).
- **Figures that follow your theme.** Accents, dashes and muted text come from your bb theme's colours, in light and dark mode.
- **Agents that know when to use one.** Top-level threads and side chats get a short rule and a `mdxcn` skill that lists every figure, its props and an example. A figure is for a warning that must not be missed, a procedure, a decision, a metric summary or a schedule, one or two per reply.
- **Readable while it streams.** The fence shows as code while the reply is written and turns into the figure once it is complete. A block that doesn't parse stays code, with a line saying why.

## How it works

A figure is a fenced block whose language is the figure's name (`callout`, `graph-timeline`). Its body is optional YAML front matter (the figure's props) and then Markdown, the same format as mdxcn's Markdown blocks. The plugin draws only in assistant replies; your own messages and file previews keep plain code blocks.

The figures are mdxcn's MIT-licensed source, bundled with the plugin. The plugin adds no tools, settings, commands or network access.
