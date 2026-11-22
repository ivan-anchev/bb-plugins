import { Markdown } from "@get-bb/plugin-sdk/app";

const FIT_TO_PARENT = [
  "pr-reviews-prose",
  "text-[length:inherit] leading-[inherit] text-inherit [&_:is(p,ul,ol,li,h1,h2,h3,h4)]:text-inherit",
  "[&_:not(pre)>code]:bg-muted",
].join(" ");

/** The size of text to read: a description, a comment, a guide's story, a draft in the comment box.
 *  why fixed, not bb's `text-sm`: a theme sets that as its UI body, and Zeron draws it 13/18, too
 *  small and tight to read a paragraph in. 14/22 is Zeron's thread messages and composer draft. */
export const READING_TYPE = "text-[14px] leading-[22px]";

export function Prose({ text, className = "" }: { text: string; className?: string }) {
  return <Markdown content={text} className={`${FIT_TO_PARENT} ${className}`} />;
}
