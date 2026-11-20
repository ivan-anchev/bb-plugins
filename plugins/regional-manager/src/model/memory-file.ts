// What a memory file is, to every side that names one: the agent tools, the RPC and the editor.
// Pure zod, so the app parses names with the same rule the server writes by.
import { z } from "zod";

/**
 * A memory file's name, relative to its folder: `/`-separated segments, none empty, `.` or `..`,
 * ending in `.md`, with no `\` or `:`. One spelling per file, so `../x.md`, an absolute path and
 * `notes.txt` never parse, and neither does a write's temp file, which ends in `.tmp`.
 */
export const memoryFileSchema = z
  .string()
  .refine(isMarkdownInside, "A memory file is a .md path inside the memory folder, such as PLAN.md or notes/api.md")
  .brand<"MemoryFile">();
export type MemoryFile = z.infer<typeof memoryFileSchema>;

/** A file's content hash; null for a file that doesn't exist, which a write with null creates. */
export const memoryVersionSchema = z.string().min(1).nullable();
export type MemoryVersion = z.infer<typeof memoryVersionSchema>;

/** What a write may put in a file: bounded, since every catch-up reads it. */
export const memoryContentSchema = z.string().max(100_000, "A memory file holds at most 100,000 characters");

/** A file as read: its text and the version a write must name to replace it. */
export const memoryTextSchema = z.object({ content: z.string(), version: z.string() });
export type MemoryText = z.infer<typeof memoryTextSchema>;

/**
 * A file's place in the order the server saw it change. Each file's revision goes up by one
 * whenever the server sees it at another version, written by it or edited on its disk, so of two
 * sightings of a file the higher revision is the later. why not the version: a hash has no order,
 * and a file can go back to an earlier text.
 */
export const memoryRevisionSchema = z.number().int().positive();
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>;

/** A file as the server saw it at one revision: its text, or null when there was no such file. */
export const memorySnapshotSchema = z.object({ text: memoryTextSchema.nullable(), revision: memoryRevisionSchema });
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;

/**
 * A write's outcome. A conflict wrote nothing: the file is no longer the version the writer named,
 * and `current` is what it is now.
 */
export const writeOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("saved"), version: z.string(), revision: memoryRevisionSchema }),
  z.object({ outcome: z.literal("conflict"), current: memorySnapshotSchema }),
]);
export type WriteOutcome = z.infer<typeof writeOutcomeSchema>;

// why no `\` or `:`: on Windows, where bb runs too, `\` also separates segments and `:` names a
// drive or a stream, so `..\x.md` leaves the folder and `C:x.md` is not the file it spells.
function isMarkdownInside(name: string): boolean {
  return name.endsWith(".md") && !/[\\:]/.test(name) && name.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * What a memory file says first, as the board's Memory lists it: its first line of text that is not a
 * heading, without a list or quote marker, else its first heading's text; null for a blank file.
 */
export function firstLineOf(content: string): string | null {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const heading = /^#{1,6}\s+/;
  const text = lines.find((line) => !heading.test(line));
  if (text !== undefined) return text.replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s*)/, "");
  return lines[0]?.replace(heading, "") ?? null;
}
