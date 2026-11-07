Agents answer with interactive UI inline in the chat: charts, tables, forms, cards and layouts, drawn by OpenUI's stock components. When a reply is data, or needs details from you, the agent draws it as live UI in the message instead of a wall of Markdown.

## What you get

- **A broad stock component set.** Bar, line, area, pie, radar and scatter charts; tables; forms with text fields, selects, date pickers, sliders, checkboxes, radios and chips; KPI, summary and product cards; tabs, accordions, steps, callouts and tags. They are [OpenUI](https://openui.com)'s own components with OpenUI's own look, unmodified.
- **Answers straight from the UI.** Submit a form or click a reply button and your answer goes to the thread as your next message, one line per field, so the agent picks up where it left off.
- **Fits bb.** Blocks follow bb's light and dark mode, sit at the message's width, and draw while the reply streams. Nothing outside a block changes.
- **Safe when the agent gets it wrong.** A block that can't be drawn shows its source in bb's ordinary code block with a short note, and the rest of the message still reads normally.

## How it works

The agent writes a short program in a fenced code block whose language is `openui`, and the plugin draws it in place. Threads whose replies you read (top-level threads and side chats) get a brief standing instruction that says when to reach for a UI block, plus a skill with OpenUI's full component reference, which the agent loads before its first block. Subagent threads and threads that workflows or automations run get neither.

The plugin draws blocks only; it adds no tools, settings, commands, or network access, and it saves nothing. What you type into a form stays in the open message until you send it.
