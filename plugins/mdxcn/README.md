# bb-plugin-mdxcn

Renders [mdxcn](https://mdxcn.dev) figures from fenced code blocks in assistant
messages, and tells user-facing agents how to write them.

- `app.tsx` registers one `experimental_codeFenceRenderer` for every figure tag
  (`callout`, `graph-kpi`, …; `row` is left out).
- `src/figure-source.ts` reads a fence body: optional YAML front matter (props)
  and the Markdown after it.
- `src/figure-children.tsx` turns that Markdown into the element tree mdxcn
  reads its data from (`terminal` takes its body literally).
- `src/figure-fence.tsx` shows bb's code block while a fence streams or fails
  to parse, and the figure once it's complete.
- `app.css` defines mdxcn's colour tokens and dashed-frame utilities from bb's
  theme; bb's plugin build only compiles default Tailwind utilities.
- `server.ts` adds a short rule and the `mdxcn` skill to top-level threads and
  side chats.
- `registry/` is mdxcn's source, vendored unmodified; see its README to update.

`src/figures.test.ts` renders every example in `skills/mdxcn/SKILL.md` through
the real renderer and checks the skill covers every registered figure.

## Develop

```sh
bb plugin install ./plugins/mdxcn   # once
bb plugin dev plugins/mdxcn         # rebuild and reload on save
npm test --workspace plugins/mdxcn
```

Instructions take effect when a thread's provider session next starts, so try
figures in a new thread.
