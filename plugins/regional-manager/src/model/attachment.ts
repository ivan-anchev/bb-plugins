// An attachment: a file an agent handed in as evidence with its handoff, copied into the plugin's
// keeping as the handoff was recorded, and tied to it. Its record ({ id, name, about, type, size })
// is kept inside that handoff's JSON, so every reader of the one reads the other; its bytes are kept
// once, in attachment_files (attachments-store.ts), and served by the attachment route
// (attachment-route.ts). Nothing edits or deletes one but its manager's removal.
import { z } from "zod";
import { ONE_LINE } from "./one-line.ts";
import type { CoordinatorId } from "./role.ts";

export const attachmentIdSchema = z.uuid().brand<"attachmentId">();
export type AttachmentId = z.infer<typeof attachmentIdSchema>;

/** How many files one handoff attaches at most. */
export const MAX_ATTACHMENTS = 5;

/** How large one attached file is at most, in bytes. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The types the plugin serves attachments as. */
export const attachmentTypeSchema = z.enum(["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime", "text/plain; charset=utf-8", "application/json"]);
export type AttachmentType = z.infer<typeof attachmentTypeSchema>;

/**
 * The extensions the plugin keeps, each with the type it is served as. why this list and no other:
 * nothing on it runs in bb's origin (no SVG, HTML or PDF), and it covers what proves work: a
 * screenshot, a short recording, a log. One table, so a type added here is added everywhere.
 */
const TYPES: Readonly<Record<string, AttachmentType>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  txt: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json",
};

/** The type a file named `name` is kept as, by its extension alone; null when the plugin keeps none of its kind. */
export function attachmentType(name: string): AttachmentType | null {
  const extension = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase();
  // why Object.hasOwn: "constructor" or "toString" as an extension must not read the prototype.
  return extension !== undefined && Object.hasOwn(TYPES, extension) ? (TYPES[extension] ?? null) : null;
}

/** The limits in a sentence, as the role texts, the tool's instructions and each refusal quote them. */
export const ATTACHMENT_LIMITS = `up to ${MAX_ATTACHMENTS} files of at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB each, of type ${Object.keys(TYPES)
  .map((extension) => `.${extension}`)
  .join(", ")}`;

/**
 * What agent_handoff takes: each file's absolute path in the caller's environment, as its shell sees
 * it, and what it shows. why the path untrimmed: it must reach bb's read byte for byte (REVIEW.md,
 * file paths). why no cap on the count here: a file past the cap is refused alone, as copy-in.ts
 * does, and the handoff still records.
 */
export const givenAttachmentsSchema = z
  .array(
    z.object({
      path: z.string().min(1).describe("The file's absolute path in your environment, saved under $BB_THREAD_STORAGE."),
      about: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .regex(ONE_LINE, "An about line is one line")
        .describe('What it shows, in one line of at most 160 characters; open it "Criterion N:" when it proves one.'),
    }),
  )
  .default([])
  .describe(`Evidence files a person should see beside your claim: ${ATTACHMENT_LIMITS}. [] for none.`);
export type GivenAttachment = z.infer<typeof givenAttachmentsSchema>[number];

/**
 * An attachment's record, as its handoff keeps it. `name`: the file's base name as it was given,
 * never normalized. `size`: its bytes as stored.
 */
const attachmentSchema = z.object({
  id: attachmentIdSchema,
  name: z.string().min(1),
  about: z.string().min(1),
  type: attachmentTypeSchema,
  size: z.number().int().min(1),
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** A handoff's attachments, as its open round shows them. */
export const attachmentsSchema = z.array(attachmentSchema).max(MAX_ATTACHMENTS);

/** A handoff's attachments as stored. why the default: a handoff stored before attachments existed has none. */
export const storedAttachmentsSchema = attachmentsSchema.default([]);

/** An attachment as the plugin copied it in, before it is stored: its record and its bytes. */
export type CopiedAttachment = Attachment & { bytes: Uint8Array };

/** A handoff before its files are copied in. why distributive: a handoff is a union by status, and each arm keeps its own fields. */
export type Unattached<T> = T extends unknown ? Omit<T, "attachments"> : never;

/**
 * A handoff as given, before it is stored: its attachments still carry their bytes, which the store
 * moves into attachment_files in the transaction that stores it (insertAttachments).
 */
export type Copied<T> = T extends unknown ? Omit<T, "attachments"> & { attachments: CopiedAttachment[] } : never;

/** Whether the feed shows it as a picture. */
export const isImage = (attachment: Pick<Attachment, "type">): boolean => attachment.type.startsWith("image/");

/**
 * A handoff's attachments as text, for catch-up and the next agent's first message: each by name,
 * kind, size and what it shows, never its path or bytes; "" when there are none, so the section is
 * left out.
 */
export function attachmentsText(attachments: readonly Attachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map(({ name, about, type, size }) => `- ${name} (${kindOf(type)}, ${sizeText(size)}): ${about}`);
  return `#### Attachments\n\nFiles the user sees in the issue's feed; you get their names, not their contents.\n\n${lines.join("\n")}`;
}

/** The route the bytes are served at, under /api/v1/plugins/regional-manager/http (attachment-route.ts). */
export const ATTACHMENT_ROUTE = "/attachment";

/** Where the app reads an attachment's bytes: same origin. why the manager in it: a URL reads only within its own manager. */
export const attachmentUrl = (managerId: CoordinatorId, id: AttachmentId): string => `/api/v1/plugins/regional-manager/http${ATTACHMENT_ROUTE}?manager=${managerId}&id=${id}`;

/** A size as people read it: "182 KB", "2.4 MB". */
export const sizeText = (bytes: number): string => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// ------------------------------------------------------------------ layer 2

const kindOf = (type: AttachmentType): string => (type.startsWith("image/") ? "image" : type.startsWith("video/") ? "recording" : "text");
