// The upgrade of memory as 0.4 laid it out. The work's state moved into the issues, so:
// - PLAN.md becomes NOTES.md, the manager's plan, reasoning and lessons, which it trims of what its
//   issues already say as it next writes it;
// - PREFERENCES.md becomes AGENTS.md, the user's standing rules for the manager;
// - DIGEST.md goes: the board no longer shows it, and the issues say what it summed up;
// - MEMORY.md's lines that index them say so.
// A move whose new file already exists leaves both as they are. Each step is a no-op once done, so
// it runs whole as the plugin loads.
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { MEMORY_INDEX, type MemoryRoot } from "./memory-files.ts";

const file = (name: string) => memoryFileSchema.parse(name);

const MOVES = [
  [file("PLAN.md"), file("NOTES.md")],
  [file("PREFERENCES.md"), file("AGENTS.md")],
] as const;

const RETIRED = file("DIGEST.md");
const INDEX = file("MEMORY.md");

/** Each of 0.4's lines in MEMORY.md, and what replaces it (null: nothing, the line goes). */
const INDEX_LINES: readonly (readonly [string, string | null])[] = [
  ["The index of this memory. Each file holds one kind of thing:", lineOf("The index of this memory.")],
  ["- PLAN.md: the plan: what to delegate, in what order, and what is done.", lineOf("- NOTES.md:")],
  ["- PREFERENCES.md: the user's standing preferences and rules.", lineOf("- AGENTS.md:")],
  ["- DIGEST.md: the latest summary for the user.", null],
];

export function upgradeMemoryFrom040(memory: MemoryRoot, ids: readonly CoordinatorId[]): void {
  for (const id of ids) upgrade(memory.of(id));
}

function upgrade(files: ReturnType<MemoryRoot["of"]>): void {
  for (const [from, to] of MOVES) {
    const old = files.read(from).text;
    if (old === null || files.read(to).text !== null) continue;
    files.write(to, old.content, null);
    files.remove(from, old.version);
  }
  const digest = files.read(RETIRED).text;
  if (digest !== null) files.remove(RETIRED, digest.version);
  const index = files.read(INDEX).text;
  if (index === null) return;
  const lines = index.content.split("\n").flatMap((line) => {
    const replaced = INDEX_LINES.find(([old]) => old === line);
    return replaced === undefined ? [line] : replaced[1] === null ? [] : [replaced[1]];
  });
  const content = lines.join("\n");
  if (content !== index.content) files.write(INDEX, content, index.version);
}

/** The line of today's MEMORY_INDEX that starts with `start`. why throw: a reworded index would leave the upgrade writing nothing in its place. */
function lineOf(start: string): string {
  const line = MEMORY_INDEX.split("\n").find((candidate) => candidate.startsWith(start));
  if (line === undefined) throw new Error(`MEMORY_INDEX has no line starting "${start}"`);
  return line;
}
