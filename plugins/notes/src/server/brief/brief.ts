// Notes → the draft a new thread starts from: text with thread pills, plus the notes' media.
// One section per note, oldest first: its quote with the quote's source as a pill and a message
// link, then the user's own words with their pills, then any file too large to attach.
//
//   Context from 2 notes:
//
//   > Burn reports spend in cents per provider…
//   — from @Show Burn's spend on the homepage (@thread:thr_x#msg=41)
//
//   Check this before shipping the weekly view
//
//   Chart starts mid-card on tall windows. Before / after from @Start the boat chart
//   Too large to attach, on disk: /Users/…/notes/media/att_… (resize.mov)
import type { Attachment, Brief, Note, NoteBody, Quote } from "../../contract.ts";

/** What became of one attachment: in the draft, or too large for bb and named by its path instead. */
export type BriefMedia = { kind: "attached"; attachment: Brief["attachments"][number] } | { kind: "tooLarge"; path: string; name: string };

export async function buildBrief(notes: readonly Note[], attach: (attachment: Attachment) => Promise<BriefMedia>): Promise<Brief> {
  if (notes.length === 0) throw new Error("Those notes are gone: deleted, or already in a thread");
  const draft = new DraftText();
  const attachments: Brief["attachments"] = [];
  draft.write(`Context from ${notes.length} ${notes.length === 1 ? "note" : "notes"}:`);
  for (const note of notes) {
    // why one at a time: each upload reads its file into memory, and one may be 35 MB.
    const media: BriefMedia[] = [];
    for (const attachment of note.attachments) media.push(await attach(attachment));
    writeNote(draft, note, media);
    for (const item of media) if (item.kind === "attached") attachments.push(item.attachment);
  }
  return { ...draft.result(), attachments };
}

// ------------------------------------------------------------------ layer 2

/** The note's parts, each on its own paragraph, with the files it could not attach listed under them. */
function writeNote(draft: DraftText, note: Note, media: readonly BriefMedia[]): void {
  const start = draft.length;
  // The note's first part opens a new paragraph; later parts follow with `gap`.
  const separate = (gap: string) => draft.write(draft.length === start ? "\n\n" : gap);
  if (note.quote !== null) {
    separate("\n\n");
    writeQuote(draft, note.quote);
  }
  if (note.body.text.trim() !== "") {
    separate("\n\n");
    draft.body(note.body);
  }
  for (const item of media) {
    if (item.kind === "attached") continue;
    separate("\n");
    draft.write(`Too large to attach, on disk: ${item.path} (${item.name})`);
  }
}

/** The passage as a Markdown quote, then where it came from: a pill, and the token that opens the message. */
function writeQuote(draft: DraftText, quote: Quote): void {
  draft.write(`${quote.text.split("\n").map((line) => `> ${line}`).join("\n")}\n— from `);
  draft.mention(quote.threadId, quote.threadTitle);
  draft.write(` (@thread:${quote.threadId}#msg=${quote.messageSeq})`);
}

/** Text, and the ranges of the pills in it, kept right as more text is appended. */
class DraftText {
  private text = "";
  private readonly mentions: Brief["mentions"] = [];

  get length(): number {
    return this.text.length;
  }

  write(text: string): void {
    this.text += text;
  }

  /** "@" + `label` as a pill. bb shows `label` on it, not a title it looks up. */
  mention(threadId: string, label: string): void {
    const from = this.text.length;
    this.text += `@${label}`;
    this.mentions.push({ kind: "thread", threadId, from, to: this.text.length, label });
  }

  /** A note's own words, its links shifted to where they land. A link's label is its stored title. */
  body({ text, mentions }: NoteBody): void {
    const offset = this.text.length;
    this.text += text;
    for (const { threadId, from, to } of mentions) {
      this.mentions.push({ kind: "thread", threadId, from: from + offset, to: to + offset, label: text.slice(from + 1, to) });
    }
  }

  result(): Pick<Brief, "text" | "mentions"> {
    return { text: this.text, mentions: this.mentions };
  }
}
