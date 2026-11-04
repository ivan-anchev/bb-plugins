Agents in bb can already draw an HTML page inside their reply, but they only do it when you ask. With this plugin on, an agent that answers from numbers (timings, benchmarks, costs, counts, test or CI results, a table you pasted) adds a chart beside its answer by itself.

## What you get

- **Charts without asking.** When an answer rests on a trend, a comparison, a distribution, or a breakdown, the agent shows it as an inline chart next to the prose.
- **Visuals that fit the thread.** The agent follows bb's inline layout and theme rules, so pages use your theme's colours, follow light and dark mode, and have no stray black backgrounds or self-scrolling frames.
- **No noise in ordinary work.** Editing, refactoring, debugging, or explaining code gets no chart, even when the code is chart code.
- **The right format for images you want to post.** Ask for an image to post or send elsewhere and the agent makes a `.png` file instead of an inline page.

## How it works

The plugin adds one short standing instruction to every thread whose replies you read: top-level threads and side chats. Subagent threads and threads that workflows or automations run report to another agent or plugin, so they get nothing.

The pages are drawn by bb's built-in **Inline visualizations** plugin, which must be enabled. This plugin adds no tools, settings, commands, or network access.
