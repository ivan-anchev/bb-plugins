// A research report's file: the regional manager's copy of what an agent handed off, kept in its
// memory folder, where the user reads and edits it in the Memory editor and any agent reads it with
// crew_memory_read. The handoff keeps the report as it was handed off; the file is the copy the
// manager hands on, by naming it in a brief. The plugin gives it to nobody, and never edits MEMORY.md.
//
// The rule for a later report on the same issue: it replaces reports/<issue>.md only while that
// file is gone or still exactly what the plugin last saved there. A file someone edited since, or
// wrote before the plugin saved anything there, stays as it is, and the report goes to the first
// free reports/<issue>-2.md, -3.md and so on; crew_catch_up names the file it went to and says why.
// Nothing a person wrote is replaced, and the handoff never fails over it.
import type { Handoff } from "../../model/handoff.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { Memory } from "./memory-files.ts";

/** Where an issue's report is saved while nobody edits it: `reports/i2.md`. */
export const reportFileOf = (issueId: IssueId): MemoryFile => memoryFileSchema.parse(`reports/${issueId}.md`);

/** Saves the report of `issueId` and says which file it went to. `earlier`: the issue's handoffs already stored. */
export function saveReport(files: Pick<Memory, "read" | "write">, issueId: IssueId, earlier: readonly Handoff[], report: string): MemoryFile {
  const content = fileText(report);
  const home = reportFileOf(issueId);
  const now = files.read(home).text;
  if ((now === null || now.content === lastSaved(home, earlier)) && files.write(home, content, now?.version ?? null).outcome === "saved") return home;
  for (let n = 2; ; n++) {
    const aside = memoryFileSchema.parse(`reports/${issueId}-${n}.md`);
    if (files.write(aside, content, null).outcome === "saved") return aside;
  }
}

/** A report as its file holds it. */
const fileText = (report: string): string => `${report}\n`;

/** What the plugin last saved to `file`, of the handoffs given; null when it saved nothing there. */
function lastSaved(file: MemoryFile, handoffs: readonly Handoff[]): string | null {
  const saved = handoffs.flatMap((handoff) => (handoff.status === "done" && handoff.delivery.kind === "report" && handoff.delivery.file === file ? [handoff.delivery.report] : [])).at(-1);
  return saved === undefined ? null : fileText(saved);
}
