import type { Attachment, Brief, Note, NoteBody, Quote } from "../../contract.ts";

/** What became of one attachment: in the draft, or too large for bb and named by its path instead. */
export type BriefMedia = { kind: "attached"; attachment: Brief["attachments"][number] } | { kind: "tooLarge"; path: string; name: string };

export async function buildBrief(notes: readonly Note[], attach: (attachment: Attachment) => Promise<BriefMedia>): Promise<Brief> {
  if (notes.length === 0) throw new Error("Those notes are gone: deleted, or sent in a message");
  const draft = new DraftText();
  const attachments: Brief["attachments"] = [];
  draft.write(`Context from ${notes.length} ${notes.length === 1 ? "note" : "notes"}:`);
  for (const note of notes) {
    const media: BriefMedia[] = [];
    for (const attachment of note.attachments) media.push(await attach(attachment));
    writeNote(draft, note, media);
    for (const item of media) if (item.kind === "attached") attachments.push(item.attachment);
  }
  return { ...draft.result(), attachments };
}

function writeNote(draft: DraftText, note: Note, media: readonly BriefMedia[]): void {
  const start = draft.length;
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

function writeQuote(draft: DraftText, quote: Quote): void {
  draft.write(`${quote.text.split("\n").map((line) => `> ${line}`).join("\n")}\n— from `);
  draft.mention(quote.threadId, quote.threadTitle);
  draft.write(` (@thread:${quote.threadId}#msg=${quote.messageSeq})`);
}

class DraftText {
  private text = "";
  private readonly mentions: Brief["mentions"] = [];

  get length(): number {
    return this.text.length;
  }

  write(text: string): void {
    this.text += text;
  }

  mention(threadId: string, label: string): void {
    const from = this.text.length;
    this.text += `@${label}`;
    this.mentions.push({ kind: "thread", threadId, from, to: this.text.length, label });
  }

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
