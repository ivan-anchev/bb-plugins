// A coordinating thread's memory: plain markdown files in `memory/<coordinator id>/` beside the
// plugin's data.db. bb has no API for a plugin's own files, so they sit beside its database, as
// Notes' media do. Tools run on the bb server, so every thread reaches the same files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { z } from "zod";
import type { CoordinatorId } from "../../model/role.ts";

/**
 * A memory file's name, relative to its folder: a `.md` file that stays inside it. Parsed once,
 * where a name comes in, so the files below never see `../x.md`, an absolute path or `notes.txt`.
 */
export const memoryFileSchema = z
  .string()
  .refine(isInsideAndMarkdown, "A memory file is a .md path inside the memory folder, such as PLAN.md or notes/api.md")
  .brand<"MemoryFile">();
type MemoryFile = z.infer<typeof memoryFileSchema>;

/** The files every memory starts with, in the order a catch-up reads them. */
const CORE_FILES = ["MEMORY.md", "GOAL.md", "PLAN.md", "PREFERENCES.md", "CREW.md", "DIGEST.md"].map((name) => memoryFileSchema.parse(name));

/** The most a catch-up returns; a file past it is named, for reading on its own. */
const CATCH_UP_BUDGET_CHARS = 40_000;
/** The most one file read returns. */
const READ_BUDGET_CHARS = 60_000;

export type MemoryRoot = ReturnType<typeof openMemoryRoot>;

/**
 * `databasePath`: `bb.storage.database().name`. A path that is not absolute would put memory
 * wherever the server happened to start, so it is refused rather than guessed at.
 */
export function openMemoryRoot(databasePath: string) {
  if (!isAbsolute(databasePath)) throw new Error(`Memory can't be kept: the database path "${databasePath}" is not absolute`);
  const root = join(dirname(databasePath), "memory");

  return {
    /** The folder that holds one folder per coordinating thread. */
    dir: root,

    of(id: CoordinatorId) {
      const dir = join(root, id);
      const pathOf = (file: MemoryFile) => join(dir, file);
      /** The file's text, or null when there is no such file. */
      const read = (file: MemoryFile) => (existsSync(pathOf(file)) ? readFileSync(pathOf(file), "utf8") : null);

      return {
        dir,

        /** Writes each core file that doesn't exist yet, so seeding twice changes nothing. */
        seed(goal: string): void {
          mkdirSync(dir, { recursive: true });
          for (const [file, text] of seedFiles(goal)) if (!existsSync(pathOf(file))) writeFileSync(pathOf(file), text);
        },

        /** The core files in a fixed order, as much as the budget allows, naming any it cut. */
        catchUp(): string {
          return withinBudget(
            CORE_FILES.map((file) => ({ file, text: read(file) ?? "(no such file)" })),
            CATCH_UP_BUDGET_CHARS,
          );
        },

        /** One file whole, or as much as the budget allows; null when there is no such file. */
        read(file: MemoryFile): string | null {
          const text = read(file);
          if (text === null || text.length <= READ_BUDGET_CHARS) return text;
          return `${text.slice(0, READ_BUDGET_CHARS)}\n\n[${file} is cut here: it has ${text.length} characters, and one read returns ${READ_BUDGET_CHARS}.]`;
        },
      };
    },
  };
}

function isInsideAndMarkdown(name: string): boolean {
  const path = normalize(name);
  return !isAbsolute(path) && path !== ".." && !path.startsWith("../") && path.endsWith(".md");
}

function seedFiles(goal: string): [MemoryFile, string][] {
  const files: [string, string][] = [
    [
      "MEMORY.md",
      `# Memory

The index of this memory. Each file holds one kind of thing:

- GOAL.md: the goal this work was started with.
- PLAN.md: the plan: what to delegate, in what order, and what is done.
- PREFERENCES.md: the user's standing preferences and rules.
- CREW.md: rules every crew thread follows.
- DIGEST.md: the latest summary for the user.
`,
    ],
    ["GOAL.md", `# Goal\n\n${goal.trim()}\n`],
    ["PLAN.md", "# Plan\n\nNo plan yet.\n"],
    ["PREFERENCES.md", "# Preferences\n\nOne rule per line: the date, then the user's words.\n"],
    ["CREW.md", "# Crew rules\n\nNone yet.\n"],
    ["DIGEST.md", "# Digest\n\nNothing to report yet.\n"],
  ];
  return files.map(([name, text]) => [memoryFileSchema.parse(name), text]);
}

function withinBudget(files: { file: MemoryFile; text: string }[], budget: number): string {
  const sections: string[] = [];
  const cut: MemoryFile[] = [];
  let used = 0;
  for (const { file, text } of files) {
    const section = `## ${file}\n\n${text.trim()}`;
    if (used + section.length > budget) cut.push(file);
    else {
      sections.push(section);
      used += section.length;
    }
  }
  if (cut.length > 0) sections.push(`Not shown, to keep this short: ${cut.join(", ")}. Read each on its own.`);
  return sections.join("\n\n");
}
