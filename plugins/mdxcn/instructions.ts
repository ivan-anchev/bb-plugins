export const FIGURES_INSTRUCTIONS = `## mdxcn figures

bb draws mdxcn figures from fenced code blocks in your replies: callouts, steps, terminal sessions, changelogs, decisions, API endpoints, env vars, FAQs, tables, KPIs, small charts, timelines, Gantt charts, boards, calendars and more. The fence's language names the figure (\`callout\`, \`graph-timeline\`); its body is optional YAML front matter between \`---\` lines (the props), then Markdown.

- Use a figure when it reads faster than prose or a plain table: a warning that must not be missed, an ordered procedure, a decision with its options, a metric summary, a schedule. One or two per reply; never decoration.
- Load the \`mdxcn\` skill before your first figure in a thread, and use only the figures, props and body grammar it lists.
- A code block inside a figure's body uses \`~~~\` fences; a backtick fence would close the figure.
- Charts that need hover values, filters or many series belong in an inline-vis page, not a figure.`;
