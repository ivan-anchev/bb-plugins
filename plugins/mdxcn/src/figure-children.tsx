import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Figures whose body is literal text, as mdxcn's MDX form wraps it in a code fence. */
const LITERAL_BODIES: ReadonlySet<string> = new Set(["terminal"]);

/**
 * A figure's body as the React elements mdxcn reads its data from: it walks
 * `children` as an element tree (lists, tables, `pre` blocks), so the Markdown
 * is converted to that tree here instead of rendered by a component later.
 * `Markdown` is synchronous and uses no hooks, so calling it is a plain
 * Markdown-to-elements conversion. Raw HTML in the body stays text.
 */
export function figureChildren(figure: string, body: string): ReactNode {
  if (body.trim() === "") return undefined;
  if (LITERAL_BODIES.has(figure)) {
    return (
      <pre>
        <code>{body}</code>
      </pre>
    );
  }
  return Markdown({ children: body, remarkPlugins: [remarkGfm] });
}
