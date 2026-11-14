# Vendored mdxcn

`default/` is mdxcn's source, copied unmodified from its shadcn registry
(`https://mdxcn.dev/r/all.json`) at upstream commit
`884eba5356762cf49f8828db8f861dc2f33d65e4` (2026-11-11). MIT, see `LICENSE`.

Left out: `graph-knap/` (filters for the Knap template engine), `mdx/` (the
`withMdxcn` MDX wrapper) and `index.ts` (re-exports both). bb renders figures
from code fences, so neither applies.

To update, download `all.json` again, replace `default/` with its `files`
(keeping the omissions above), and run `npm run check` from the repo root.
Edit nothing in `default/`: theme and bb glue live in `../app.css` and `../src/`.
