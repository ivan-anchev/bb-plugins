import type { Handoff } from "../../model/handoff.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { memoryFileSchema, type MemoryFile, type MemoryText } from "../../model/memory-file.ts";
import type { Memory } from "./memory-files.ts";

/** Where an issue's report is saved while nobody edits it: `reports/BBP-2.md`. */
export const reportFileOf = (issueId: IssueId): MemoryFile => memoryFileSchema.parse(`reports/${issueId}.md`);

/**
 * Saves the report of `issueId` to its file and stores the handoff that names it with `commit`, as
 * one operation; returns what `commit` did. `earlier`: the issue's handoffs already stored.
 *
 * If anything throws before `commit` returns, the handoff is not stored, so the file is put back as
 * it was (or removed, when the plugin created it), unless it no longer holds this report: a later
 * write is someone else's, and stays. Once `commit` has returned, the handoff is stored and the file
 * stays whatever runs next, the doorbell included.
 *
 * A crash between the save and the commit leaves the file holding a report no stored handoff names.
 * The next report reads it as someone's edit, so it goes beside it (-2.md) and the stray file stays
 * until someone removes it: nothing is lost, and nothing is replaced unless the plugin saved it.
 */
export function storeReport<T>(files: Pick<Memory, "read" | "write" | "remove">, issueId: IssueId, earlier: readonly Handoff[], report: string, commit: (file: MemoryFile) => T): T {
  const content = fileText(report);
  const { file, before } = placeOf(files, issueId, earlier);
  try {
    if (files.write(file, content, before?.version ?? null).outcome === "conflict") throw new Error(`${file} changed on disk as the report was saved there. Try again.`);
    return commit(file);
  } catch (error) {
    putBack(files, file, content, before);
    throw error;
  }
}

function placeOf(files: Pick<Memory, "read">, issueId: IssueId, earlier: readonly Handoff[]): { file: MemoryFile; before: MemoryText | null } {
  const home = reportFileOf(issueId);
  const now = files.read(home).text;
  if (now === null || now.content === lastSaved(home, earlier)) return { file: home, before: now };
  for (let n = 2; ; n++) {
    const aside = memoryFileSchema.parse(`reports/${issueId}-${n}.md`);
    if (files.read(aside).text === null) return { file: aside, before: null };
  }
}

function putBack(files: Pick<Memory, "read" | "write" | "remove">, file: MemoryFile, content: string, before: MemoryText | null): void {
  const now = files.read(file).text;
  if (now === null || now.content !== content) return;
  if (before === null) files.remove(file, now.version);
  else files.write(file, before.content, now.version);
}

const fileText = (report: string): string => `${report}\n`;

function lastSaved(file: MemoryFile, handoffs: readonly Handoff[]): string | null {
  const saved = handoffs.flatMap((handoff) => (handoff.status === "done" && handoff.delivery.kind === "report" && handoff.delivery.file === file ? [handoff.delivery.report] : [])).at(-1);
  return saved === undefined ? null : fileText(saved);
}
