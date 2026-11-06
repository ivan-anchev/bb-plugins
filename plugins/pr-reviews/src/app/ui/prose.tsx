// The agent's and the author's text, rendered as markdown by bb's chat renderer: one renderer for
// every piece of guide prose, so `code`, emphasis and links look the same everywhere.
import { Markdown } from "@get-bb/plugin-sdk/app";

// why: bb's Markdown sets chat type, 14px with relaxed leading and the foreground colour on every
// paragraph. Guide text takes its size, leading and colour from where it sits instead, and a
// `className` with its own size or colour still wins.
const INHERIT_TYPE = "text-[length:inherit] leading-[inherit] text-inherit [&_li]:text-inherit [&_p]:text-inherit";

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <Markdown content={text} className={`${INHERIT_TYPE} ${className}`} />;
}
