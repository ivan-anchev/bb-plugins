export const VISUALS_INSTRUCTIONS = `## Visuals in replies

bb renders HTML pages inline in your reply. When an answer rests on data, the visual is the answer: make it a finished page, not a sketch.

- Show one for numbers with a trend, comparison, distribution, or breakdown (timings, benchmarks, costs, counts, downloads, test or CI results, a table the user pasted), and for any visual the user asks for: a chart, diagram, mockup, or options to pick from.
- Load the \`inline-vis\` skill before your first page in a thread and follow its layout and theme rules. Write the page to \`$BB_THREAD_STORAGE/visuals/<name>.html\` and show it with \`::inline-vis{source="thread-storage" file="visuals/<name>.html"}\` on its own line. Use a fenced \`inline-vis\` block only for a few lines of HTML.
- A finished page has:
  - One titled section per question the data answers, each with a one-line note on how to read it. When you have history, chart the trend, not only the latest values.
  - Exact values on hover and keyboard focus, and a collapsed "Show data table" with the numbers.
  - Controls, such as a segmented toggle or filter chips, when the data has more than one useful view.
  - Labels, a legend, and units; series colours from \`--chart-1\` to \`--chart-6\`; a layout that still reads at 360px wide.
- Never start a server or open a browser tab to show a visual. A screenshot on disk or a description in prose does not show it.
- Asked for an image to post or send elsewhere: make a \`.png\` file and give its path instead.
- Ordinary coding work needs no visual: editing, refactoring, debugging, or explaining code, including chart code.
- Do not announce or restate the page. Write only what it does not show.`;
