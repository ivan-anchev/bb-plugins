// A saved note's text cut at its thread links, so the view can mark each linked title.
import type { NoteBody } from "../../../contract.ts";

/** A run of a note's text: plain words (`threadId` null), or a linked thread's "@Title". */
type BodyPart = { text: string; threadId: string | null };

/** The text in order, each link its own part. The contract keeps links in order and apart. */
export function bodyParts({ text, mentions }: NoteBody): BodyPart[] {
  const parts: BodyPart[] = [];
  let at = 0;
  for (const { threadId, from, to } of mentions) {
    if (at < from) parts.push({ text: text.slice(at, from), threadId: null });
    parts.push({ text: text.slice(from, to), threadId });
    at = to;
  }
  if (at < text.length) parts.push({ text: text.slice(at), threadId: null });
  return parts;
}
