import type { InboxEvent } from "./inbox-event.ts";

/** An event about the coordinating thread's own working tree. */
export type OwnTreeEvent = Extract<InboxEvent, { kind: "coordinator-edited-files" | "coordinator-tree-clean" }>;

/** How many changed files the board warns of after `last`, the latest such event: 0 when none is warned of. */
export const warnedFileCount = (last: OwnTreeEvent | null): number => (last?.kind === "coordinator-edited-files" ? last.fileCount : 0);

/**
 * What a read of `fileCount` changed files records after `last`: nothing when the board already
 * says so, else the new count, or that the tree is clean again. Once per state, never per turn.
 */
export function ownTreeEventAfter(last: OwnTreeEvent | null, fileCount: number): OwnTreeEvent | null {
  if (fileCount === warnedFileCount(last)) return null;
  return fileCount === 0 ? { kind: "coordinator-tree-clean" } : { kind: "coordinator-edited-files", fileCount };
}

/** A count of changed files, in words: "1 file", "3 files". */
export const filesText = (count: number): string => (count === 1 ? "1 file" : `${count} files`);
