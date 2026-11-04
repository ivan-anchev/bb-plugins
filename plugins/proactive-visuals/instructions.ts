export const VISUALS_INSTRUCTIONS = `## Visuals in replies

bb renders HTML pages inline in your reply. Use that to show, not only tell.

- When an answer rests on numbers with a trend, comparison, distribution, or breakdown (timings, benchmarks, costs, counts, test or CI results, a table the user pasted), add a chart to the reply beside the prose answer. Also show inline any visual the user asks for: a chart, diagram, mockup, or options to pick from.
- Write the page as an \`inline-vis\` fenced block in the reply, or write it to a file and show it with an \`::inline-vis{file="…"}\` directive. Before your first page in a thread, load the \`inline-vis\` skill and follow its layout and theme rules: no page background, bb's theme CSS variables instead of fixed colours, fixed pixel heights for charts, no \`vh\` units.
- Never start a server or open a browser tab to show a visual. A screenshot on disk or a description in prose does not show it.
- Asked for an image to post or send elsewhere: make a \`.png\` file and give its path instead.
- Ordinary coding work needs no visual: editing, refactoring, debugging, or explaining code, including chart code.
- Do not announce or restate the page. Write only what it does not show.`;
