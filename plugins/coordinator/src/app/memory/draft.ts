// What the Memory editor shows for one file: the file as last known, or the user's draft over it.
// Only the user's edit is state; everything else follows the current read, so a write by the
// Coordinator shows at once in a file the user isn't editing. The draft and the save live apart:
// the draft in the browser, so a remount or a reload keeps it, and the save with the page, whose
// write it waits for.
import { z } from "zod";
import { memoryFileSchema, memoryVersionSchema, type MemoryFile, type MemorySnapshot, type MemoryText, type MemoryVersion, type WriteOutcome } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";

/** The user's unsaved text, and the version of the file they started it from. */
const draftSchema = z.object({ text: z.string(), base: memoryVersionSchema });
export type Draft = z.infer<typeof draftSchema>;

/** Every unsaved draft of one coordinating thread's memory, by file, as the browser keeps them. */
export const draftsSchema = z.partialRecord(memoryFileSchema, draftSchema);
type Drafts = z.infer<typeof draftsSchema>;

/** Where the browser keeps a coordinating thread's drafts. */
export const draftsKeyOf = (coordinatorId: CoordinatorId): string => `coordinator-memory-drafts:${coordinatorId}`;

/** The drafts with `file`'s replaced, or dropped for null; null once none is left, so nothing stays stored. */
export function withDraft(drafts: Drafts | null, file: MemoryFile, draft: Draft | null): Drafts | null {
  const next = { ...drafts, [file]: draft ?? undefined };
  return Object.values(next).some((kept) => kept !== undefined) ? next : null;
}

/** One file's save, kept by the Memory page, so it settles the file it was made for even after its editor has gone. */
export type SaveState = {
  /** A save is out. The editor takes no typing until it settles. */
  saving: boolean;
  /** The last save's outcome: the file as the write found or left it. */
  written: Written | null;
  /** Why the last save failed, until the next one. */
  failure: string | null;
};

/** One file's edit as its editor sees it: the user's draft, if any, and its save. */
export type FileEdit = SaveState & { draft: Draft | null };

/** The file as a write found it (a refused save) or left it (`saved`). */
type Written = { file: MemorySnapshot; saved: boolean };

/** A save to send: the draft, and the version it replaces. */
export type Save = { draft: Draft; base: MemoryVersion };

export type EditorState =
  | { kind: "clean"; text: string }
  | { kind: "edited"; draft: Draft }
  /** The file moved on under the draft. `newer` is the file now; null when it was deleted. */
  | { kind: "conflict"; draft: Draft; newer: MemoryText | null };

export const NO_SAVE: SaveState = { saving: false, written: null, failure: null };

const versionOf = (file: MemoryText | null): MemoryVersion => file?.version ?? null;

/**
 * The file as the editor knows it: the later of the read and what the last save learned, by the
 * server's revision. A read and a save's answer arrive in no set order, and a read that failed to
 * refresh keeps its older data, so neither is newer for arriving last.
 */
export function fileNow(read: MemorySnapshot, save: SaveState): MemorySnapshot {
  return save.written !== null && save.written.file.revision > read.revision ? save.written.file : read;
}

/** Whether the file now is the one this editor last saved. */
export function isSaved(file: MemorySnapshot, save: SaveState): boolean {
  return save.written?.saved === true && save.written.file.revision === file.revision;
}

/** The editor over the file as known now, with the user's draft if any. */
export function editorState(file: MemoryText | null, draft: Draft | null): EditorState {
  if (draft === null) return { kind: "clean", text: file?.content ?? "" };
  return draft.base === versionOf(file) ? { kind: "edited", draft } : { kind: "conflict", draft, newer: file };
}

/**
 * The draft after the user types `text`: none once it matches the file as known now. A draft keeps
 * the version it started from, null included, so a file that moved on under it stays a conflict.
 */
export function typed(text: string, file: MemoryText | null, draft: Draft | null): Draft | null {
  if (text === (file?.content ?? "")) return null;
  return { text, base: draft === null ? versionOf(file) : draft.base };
}

/** The save the user can send now: none with no draft, or while one is out. */
export function saveOf(read: MemorySnapshot, edit: FileEdit): Save | null {
  if (edit.saving) return null;
  const state = editorState(fileNow(read, edit).text, edit.draft);
  if (state.kind === "clean") return null;
  return { draft: state.draft, base: saveBase(state) };
}

/** The save once `save` is answered: the file as the write found it (refused) or left it (saved). */
export function settled(save: Save, outcome: WriteOutcome): SaveState {
  switch (outcome.outcome) {
    case "saved":
      return { saving: false, written: { file: { text: { content: save.draft.text, version: outcome.version }, revision: outcome.revision }, saved: true }, failure: null };
    case "conflict":
      return { saving: false, written: { file: outcome.current, saved: false }, failure: null };
    default:
      return outcome satisfies never;
  }
}

/**
 * The draft once `save` is answered. A saved draft is dropped only while it is still the draft the
 * user has; a refused one stays, beside the file as the write found it.
 */
export const draftAfter = (draft: Draft | null, save: Save, outcome: WriteOutcome): Draft | null =>
  outcome.outcome === "saved" && draft?.text === save.draft.text ? null : draft;

/**
 * The version a save names. In a conflict it is the newer version shown beside the draft, so
 * saving replaces only what the user has seen; anything newer still refuses it.
 */
function saveBase(state: Exclude<EditorState, { kind: "clean" }>): MemoryVersion {
  return state.kind === "conflict" ? versionOf(state.newer) : state.draft.base;
}
