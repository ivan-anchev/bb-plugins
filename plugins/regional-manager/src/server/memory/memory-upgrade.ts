import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { SEEDS, type MemoryRoot } from "./memory-files.ts";

const file = (name: string) => memoryFileSchema.parse(name);

type LineTable = readonly (readonly [string, string | null])[];

const MOVES: readonly { from: MemoryFile; to: MemoryFile; lines: LineTable }[] = [
  {
    from: file("PLAN.md"),
    to: file("NOTES.md"),
    lines: [
      ["# Plan", lineOf(SEEDS["NOTES.md"], "# ")],
      ["No plan yet.", lineOf(SEEDS["NOTES.md"], "Nothing yet.")],
    ],
  },
  {
    from: file("PREFERENCES.md"),
    to: file("RULES.md"),
    lines: [
      ["# Preferences", lineOf(SEEDS["RULES.md"], "# ")],
      ["One rule per line: the date, then the user's words.", lineOf(SEEDS["RULES.md"], "One rule per line")],
    ],
  },
];

const RETIRED = { file: file("DIGEST.md"), instead: "your reply to the user is the summary" };

const INDEX = file("MEMORY.md");

const INDEX_LINES: LineTable = [
  ["The index of this memory. Each file holds one kind of thing:", lineOf(SEEDS["MEMORY.md"], "The index of this memory.")],
  ["- PLAN.md: the plan: what to delegate, in what order, and what is done.", lineOf(SEEDS["MEMORY.md"], "- NOTES.md:")],
  ["- PREFERENCES.md: the user's standing preferences and rules.", lineOf(SEEDS["MEMORY.md"], "- RULES.md:")],
  ["- DIGEST.md: the latest summary for the user.", null],
];

export function upgradeMemoryFrom040(memory: MemoryRoot, ids: readonly CoordinatorId[]): void {
  for (const id of ids) upgrade(memory.of(id));
}

/** Why crew_memory_write refuses `name`, a file 0.4 kept that today's memory renamed or dropped: always, so none comes back. null: it is no such file. */
export function replacedFileWriteRefusal(name: MemoryFile): string | null {
  const move = MOVES.find(({ from }) => from === name);
  if (move !== undefined) return `${name} is now ${move.to}: use ${move.to} instead.`;
  return name === RETIRED.file ? `${name} is retired: ${RETIRED.instead}.` : null;
}

/**
 * Why crew_memory_read refuses `name`, a file 0.4 kept, once it is gone. A move that found its new file
 * there already left the old one, and the manager can still read it. null: it is on disk, or no such file.
 */
export function replacedFileReadRefusal(name: MemoryFile, onDisk: boolean): string | null {
  return onDisk ? null : replacedFileWriteRefusal(name);
}

function upgrade(files: ReturnType<MemoryRoot["of"]>): void {
  for (const { from, to, lines } of MOVES) {
    const old = files.read(from).text;
    if (old === null) continue;
    const moved = rewritten(old.content, lines);
    const now = files.read(to).text;
    if (now === null) files.write(to, moved, null);
    else if (now.content !== moved) continue;
    files.remove(from, old.version);
  }
  const digest = files.read(RETIRED.file).text;
  if (digest !== null) files.remove(RETIRED.file, digest.version);
  const index = files.read(INDEX).text;
  if (index === null) return;
  const content = rewritten(index.content, INDEX_LINES);
  if (content !== index.content) files.write(INDEX, content, index.version);
}

function rewritten(content: string, table: LineTable): string {
  return content
    .split("\n")
    .flatMap((line) => {
      const replaced = table.find(([old]) => old === line);
      return replaced === undefined ? [line] : replaced[1] === null ? [] : [replaced[1]];
    })
    .join("\n");
}

function lineOf(text: string, start: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(start));
  if (line === undefined) throw new Error(`No seeded line starts "${start}"`);
  return line;
}
