import type { PluginAgentToolResult } from "@get-bb/plugin-sdk";
import type { MemoryFile, MemoryText, WriteOutcome } from "../../model/memory-file.ts";
import { CORE_FILES, type Memory } from "../memory/memory-files.ts";

const CATCH_UP_BUDGET_CHARS = 40_000;
const READ_BUDGET_CHARS = 60_000;

/** The core files in full, in a fixed order, as much as the budget allows, then every other file by name. */
export function catchUpText(memory: Pick<Memory, "read" | "list">): string {
  const sections: string[] = [];
  const cut: MemoryFile[] = [];
  let used = 0;
  for (const file of CORE_FILES) {
    const section = sectionOf(file, memory.read(file).text);
    if (used + section.length > CATCH_UP_BUDGET_CHARS) cut.push(file);
    else {
      sections.push(section);
      used += section.length;
    }
  }
  if (cut.length > 0) sections.push(`Not shown, to keep this short: ${cut.join(", ")}. Read each on its own.`);
  const others = memory.list().filter((file) => !CORE_FILES.includes(file));
  if (others.length > 0) sections.push(`Other memory files, read each with crew_memory_read: ${others.join(", ")}.`);
  return sections.join("\n\n");
}

/** One file whole, or as much as the budget allows. */
export function readText(file: MemoryFile, text: MemoryText): string {
  if (text.content.length <= READ_BUDGET_CHARS) return sectionOf(file, text);
  const shown = { ...text, content: text.content.slice(0, READ_BUDGET_CHARS) };
  return `${sectionOf(file, shown)}\n\n[${file} is cut here: it has ${text.content.length} characters, and one read returns ${READ_BUDGET_CHARS}. Don't write it back whole from this read.]`;
}

/** A write's outcome; a refused write carries the file as it is now, to merge into. */
export function writeResult(file: MemoryFile, outcome: WriteOutcome): PluginAgentToolResult {
  switch (outcome.outcome) {
    case "saved":
      return `Saved ${file}, now version ${outcome.version}.`;
    case "conflict":
      return { content: [{ type: "text", text: conflictText(file, outcome.current.text) }], isError: true };
  }
}

const conflictText = (file: MemoryFile, current: MemoryText | null): string =>
  current === null
    ? `Nothing was written: ${file} no longer exists. Write it again with baseVersion null to create it.`
    : `Nothing was written: ${file} changed since you read it, maybe edited by the user. Merge your change into its current text below, keeping their edits, and write again with baseVersion "${current.version}".\n\n${sectionOf(file, current)}`;

const sectionOf = (file: MemoryFile, text: MemoryText | null): string =>
  text === null ? `## ${file} (no such file)` : `## ${file} (version ${text.version})\n\n${text.content.trim()}`;
