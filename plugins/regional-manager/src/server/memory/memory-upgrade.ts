// The upgrade of memory as 0.4 laid it out. The work's state moved into the issues, so:
// - PLAN.md becomes NOTES.md, the manager's plan, reasoning and lessons, which it trims of what its
//   issues already say as it next writes it;
// - PREFERENCES.md becomes AGENTS.md, the user's standing rules for the manager;
// - DIGEST.md goes: the board no longer shows it, and the issues say what it summed up;
// - MEMORY.md's lines that index them say so.
// A moved file keeps every line but those 0.4 seeded it with, which become today's; a move whose new
// file already exists leaves both as they are. Each step is a no-op once done, so it runs whole as
// the plugin loads. The same table tells a memory tool what replaced a 0.4 file it is asked for, as a
// manager whose conversation began before the upgrade still names them: a write is always refused, a
// read only once the file is gone.
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { MEMORY_INDEX, SEEDS, type MemoryRoot } from "./memory-files.ts";

const file = (name: string) => memoryFileSchema.parse(name);

/**
 * Lines 0.4 wrote, each with what replaces it (null: nothing, the line goes). Any other line, the
 * user's own or one they reworded, stays as it is.
 */
type LineTable = readonly (readonly [string, string | null])[];

/** Each file 0.4 kept that today's memory renamed: the file it became, and the lines 0.4 seeded it with. */
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
    to: file("AGENTS.md"),
    lines: [
      ["# Preferences", lineOf(SEEDS["AGENTS.md"], "# ")],
      ["One rule per line: the date, then the user's words.", lineOf(SEEDS["AGENTS.md"], "One rule per line")],
    ],
  },
];

/** The file 0.4 kept that today's memory dropped, and what took its place. */
const RETIRED = { file: file("DIGEST.md"), instead: "your reply to the user is the summary" };

const INDEX = file("MEMORY.md");

const INDEX_LINES: LineTable = [
  ["The index of this memory. Each file holds one kind of thing:", lineOf(MEMORY_INDEX, "The index of this memory.")],
  ["- PLAN.md: the plan: what to delegate, in what order, and what is done.", lineOf(MEMORY_INDEX, "- NOTES.md:")],
  ["- PREFERENCES.md: the user's standing preferences and rules.", lineOf(MEMORY_INDEX, "- AGENTS.md:")],
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
    if (old === null || files.read(to).text !== null) continue;
    files.write(to, rewritten(old.content, lines), null);
    files.remove(from, old.version);
  }
  const digest = files.read(RETIRED.file).text;
  if (digest !== null) files.remove(RETIRED.file, digest.version);
  const index = files.read(INDEX).text;
  if (index === null) return;
  const content = rewritten(index.content, INDEX_LINES);
  if (content !== index.content) files.write(INDEX, content, index.version);
}

/** `content` with each line `table` names replaced, or dropped. */
function rewritten(content: string, table: LineTable): string {
  return content
    .split("\n")
    .flatMap((line) => {
      const replaced = table.find(([old]) => old === line);
      return replaced === undefined ? [line] : replaced[1] === null ? [] : [replaced[1]];
    })
    .join("\n");
}

/** The line of today's `text` that starts with `start`. why throw: a reworded seed would leave the upgrade writing nothing in its place. */
function lineOf(text: string, start: string): string {
  const line = text.split("\n").find((candidate) => candidate.startsWith(start));
  if (line === undefined) throw new Error(`No seeded line starts "${start}"`);
  return line;
}
