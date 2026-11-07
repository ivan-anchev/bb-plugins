// The standing rule every person-facing thread gets. It says when to answer
// with a UI block and points at the skill; the component spec itself is too
// long for bb's 4096-character instruction limit, so it lives in the skill.
export const SKILL_NAME = "generative-ui";

export const UI_BLOCK_INSTRUCTIONS = `## Interactive UI in replies

bb draws OpenUI Lang blocks in your reply as live UI, using OpenUI's stock components: charts, tables, forms, cards, tabs, steps and layouts.

- Answer with a UI block when the answer is data or needs input: numbers to compare or follow over time (a chart), records with several fields (a table), a few items to summarize side by side (cards), or details you need from the user (a form, or buttons to pick from). Prefer a UI block to an inline-vis HTML page for these.
- Load the \`${SKILL_NAME}\` skill before your first UI block in a thread. It has the syntax and the signature of every component. Never guess a component name or its argument order.
- Write the block as a fenced code block with the language \`openui\`, and keep any prose outside it. Each block is a complete program that starts with \`root = Stack(...)\`.
- A form submit or a button with @ToAssistant sends the user's answer to this thread as their next message. When you ask for input this way, end your turn and wait for it.
- Ordinary coding work needs no UI block: editing, refactoring, debugging, or explaining code.`;
