// The agent's and the author's text, rendered as markdown by bb's chat renderer: one renderer for
// every piece of guide prose, so `code`, emphasis and links look the same everywhere.
import { Markdown } from "@get-bb/plugin-sdk/app";

// why: bb's Markdown is styled for a chat message on the page background. Guide text sits on other
// surfaces too (a finding block, "For you to decide"), so it adapts to where it sits:
// - size, leading and colour come from the parent: bb sets chat type on the root and the foreground
//   colour on every paragraph, list, list item and heading. A `className` with its own size or
//   colour still wins.
// - inline code sits on the theme's muted surface.
// - the space between blocks is `pr-reviews-prose` in app.css, not bb's chat margins: GitHub's
//   markdown rhythm, scaled to the type size the parent sets.
const FIT_TO_PARENT = [
  "pr-reviews-prose",
  "text-[length:inherit] leading-[inherit] text-inherit [&_:is(p,ul,ol,li,h1,h2,h3,h4)]:text-inherit",
  "[&_:not(pre)>code]:bg-muted",
].join(" ");

/** The size of text to read: a description, a comment, a guide's story, a draft in the comment box.
 *  why fixed, not bb's `text-sm`: a theme sets that as its UI body, and Zeron draws it 13/18, too
 *  small and tight to read a paragraph in. 14/22 is Zeron's own composer draft. */
export const READING_TYPE = "text-[14px] leading-[22px]";

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <Markdown content={text} className={`${FIT_TO_PARENT} ${className}`} />;
}
