import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentIdSchema, noteIdSchema, type Attachment, type Brief, type Note } from "../../contract.ts";
import { buildBrief, type BriefMedia } from "./brief.ts";

function note(n: number, parts: Partial<Pick<Note, "quote" | "body" | "attachments">>): Note {
  return {
    id: noteIdSchema.parse(`note_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    createdAt: 1_000 * n,
    quote: null,
    body: { text: "", mentions: [] },
    attachments: [],
    ...parts,
  };
}

function attachment(n: number, name: string, mimeType: Attachment["mimeType"], sizeBytes = 1_000): Attachment {
  return { id: attachmentIdSchema.parse(`att_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`), name, mimeType, sizeBytes };
}

const uploadAll = async ({ name, mimeType, sizeBytes }: Attachment): Promise<BriefMedia> => ({
  kind: "attached",
  attachment: { type: mimeType.startsWith("image/") ? "localImage" : "localFile", path: `uploads/${name}`, name, mimeType, sizeBytes },
});

function pillTexts({ text, mentions }: Brief): string[] {
  return mentions.map(({ from, to }) => text.slice(from, to));
}

const quoteNote = note(1, {
  quote: { text: "Burn reports spend in cents per provider", threadId: "thr_burn", threadTitle: "Show Burn's spend", messageSeq: 41 },
  body: { text: "Check this before shipping", mentions: [] },
  attachments: [attachment(1, "chart.png", "image/png")],
});
const linkNote = note(2, {
  body: { text: "Chart starts mid-card, see @Start the boat chart", mentions: [{ threadId: "thr_boat", from: 27, to: 48 }] },
  attachments: [attachment(2, "resize.mp4", "video/mp4", 16 * 1024 * 1024)],
});

test("two notes read as a header, then each note's quote with its source, then its words", async () => {
  const brief = await buildBrief([quoteNote, linkNote], uploadAll);

  assert.equal(
    brief.text,
    [
      "Context from 2 notes:",
      "",
      "> Burn reports spend in cents per provider",
      "— from @Show Burn's spend (@thread:thr_burn#msg=41)",
      "",
      "Check this before shipping",
      "",
      "Chart starts mid-card, see @Start the boat chart",
    ].join("\n"),
  );
});

test("a pill for the quote's source and for each link, labelled with the stored titles", async () => {
  const brief = await buildBrief([quoteNote, linkNote], uploadAll);

  assert.deepEqual(
    brief.mentions.map(({ kind, threadId, label }) => ({ kind, threadId, label })),
    [
      { kind: "thread", threadId: "thr_burn", label: "Show Burn's spend" },
      { kind: "thread", threadId: "thr_boat", label: "Start the boat chart" },
    ],
  );
  assert.deepEqual(pillTexts(brief), ["@Show Burn's spend", "@Start the boat chart"]);
});

test("the notes' media are attached in note order", async () => {
  const brief = await buildBrief([quoteNote, linkNote], uploadAll);

  assert.deepEqual(
    brief.attachments.map(({ type, name }) => ({ type, name })),
    [
      { type: "localImage", name: "chart.png" },
      { type: "localFile", name: "resize.mp4" },
    ],
  );
});

test("a file too large to attach is named by its path under its note, and is not attached", async () => {
  const big = note(3, { body: { text: "Recording of the bug", mentions: [] }, attachments: [attachment(3, "huge.mov", "video/quicktime")] });
  const brief = await buildBrief([big], async ({ name }) => ({ kind: "tooLarge", path: `/data/notes/media/${name}`, name }));

  assert.equal(brief.text, "Context from 1 note:\n\nRecording of the bug\nToo large to attach, on disk: /data/notes/media/huge.mov (huge.mov)");
  assert.deepEqual(brief.attachments, []);
});

test("a note of files only adds its attachments and no text, or the path line alone when too large", async () => {
  const attached = note(4, { attachments: [attachment(4, "shot.png", "image/png")] });
  const tooLarge = note(5, { attachments: [attachment(5, "huge.mp4", "video/mp4")] });
  const brief = await buildBrief([attached, tooLarge], async (file) =>
    file.name === "huge.mp4" ? { kind: "tooLarge", path: "/m/huge.mp4", name: file.name } : uploadAll(file),
  );

  assert.equal(brief.text, "Context from 2 notes:\n\nToo large to attach, on disk: /m/huge.mp4 (huge.mp4)");
  assert.deepEqual(
    brief.attachments.map(({ name }) => name),
    ["shot.png"],
  );
});

test("a quote over several lines stays one Markdown quote", async () => {
  const brief = await buildBrief(
    [note(6, { quote: { text: "first line\nsecond line", threadId: "thr_q", threadTitle: "Quoted", messageSeq: 3 } })],
    uploadAll,
  );

  assert.equal(brief.text, "Context from 1 note:\n\n> first line\n> second line\n— from @Quoted (@thread:thr_q#msg=3)");
  assert.deepEqual(pillTexts(brief), ["@Quoted"]);
});

test("links in a later note keep their ranges after an earlier note's pills", async () => {
  const text = "@Alpha then @Beta";
  const later = note(7, { body: { text, mentions: [{ threadId: "thr_a", from: 0, to: 6 }, { threadId: "thr_b", from: 12, to: 17 }] } });

  const brief = await buildBrief([quoteNote, later], uploadAll);

  assert.deepEqual(pillTexts(brief), ["@Show Burn's spend", "@Alpha", "@Beta"]);
});

test("no notes left to brief is an error, not an empty brief", async () => {
  await assert.rejects(buildBrief([], uploadAll), /Those notes are gone/);
});
