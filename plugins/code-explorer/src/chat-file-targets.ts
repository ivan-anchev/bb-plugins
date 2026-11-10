import { z } from "zod";

/** A file link bb rendered in a chat message: it rewrites every local file link to a `file:` URL. */
export const FILE_LINK_SELECTOR = '[data-markdown-preview] a[href^="file:"]';

/** An @-mention pill bb rendered; the attribute holds the mention as JSON. */
export const MENTION_SELECTOR = "[data-prompt-mention-resource]";

const fileMention = z.object({ kind: z.literal("path"), entryKind: z.literal("file"), path: z.string().min(1) });

/** The file a chat file link points at, or null when the href names no file. */
export function filePathOfLink(href: string): string | null {
  const url = URL.parse(href);
  if (url === null || url.protocol !== "file:") return null;
  const path = decodeURIComponent(url.pathname);
  return path.endsWith("/") ? null : path;
}

/** The file an @-mention pill names, or null for folders, threads and every other mention kind. */
export function filePathOfMention(resource: string): string | null {
  const mention = fileMention.safeParse(jsonOf(resource));
  return mention.success ? mention.data.path : null;
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
