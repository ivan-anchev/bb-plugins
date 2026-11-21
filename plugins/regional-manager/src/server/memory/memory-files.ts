// A coordinating thread's memory: plain markdown files in `memory/<coordinator id>/` beside the
// plugin's data.db. bb has no API for a plugin's own files, so they sit beside its database, as
// Notes' media do. Tools run on the bb server, so every thread reaches the same files.
//
// Two writers share them, the Coordinator and the user, so every write names the version it
// replaces and is refused when the file has moved on. why no lock: each write reads, compares and
// renames synchronously, so nothing else in the server runs between its check and its rename. A
// file edited on the server's disk is simply read on the next call.
//
// Every read and write also gives the file's revision, the order the server saw it change in, so
// the editor can tell which of two sightings is the later. A file edited on disk gets its next
// revision when it is next read.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { memoryFileSchema, type MemoryFile, type MemorySnapshot, type MemoryVersion, type WriteOutcome } from "../../model/memory-file.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

/** The files every memory starts with, in the order a catch-up reads them and the editor lists them. */
export const CORE_FILES = ["MEMORY.md", "GOAL.md", "NOTES.md", "AGENTS.md", "CREW.md"].map((name) => memoryFileSchema.parse(name));

export type MemoryRoot = ReturnType<typeof openMemoryRoot>;
export type Memory = ReturnType<MemoryRoot["of"]>;

/**
 * `databasePath`: `bb.storage.database().name`. A path that is not absolute would put memory
 * wherever the server happened to start, so it is refused rather than guessed at. `revisions`
 * counts each file's revisions. `onWritten` runs after every write that changed a file, whoever
 * made it.
 */
export function openMemoryRoot(databasePath: string, revisions: Pick<Store, "memoryRevision">, onWritten: (id: CoordinatorId) => void) {
  if (!isAbsolute(databasePath)) throw new Error(`Memory can't be kept: the database path "${databasePath}" is not absolute`);
  const root = join(dirname(databasePath), "memory");

  return {
    /** The folder that holds one folder per coordinating thread. */
    dir: root,

    of(id: CoordinatorId) {
      const dir = join(root, id);
      const pathOf = (file: MemoryFile) => join(dir, file);

      /** The file's text and version (null: there is no such file), at its revision. */
      function read(file: MemoryFile): MemorySnapshot {
        const content = existsSync(pathOf(file)) ? readFileSync(pathOf(file), "utf8") : null;
        const text = content === null ? null : { content, version: versionOf(content) };
        return { text, revision: revisions.memoryRevision(id, file, text?.version ?? null) };
      }

      /**
       * Replaces the file whole if it is still `baseVersion` (null: if it doesn't exist yet).
       * Otherwise writes nothing and returns what the file is now.
       */
      function write(file: MemoryFile, content: string, baseVersion: MemoryVersion): WriteOutcome {
        const current = read(file);
        if ((current.text?.version ?? null) !== baseVersion) return { outcome: "conflict", current };
        writeWhole(pathOf(file), content);
        const version = versionOf(content);
        const revision = revisions.memoryRevision(id, file, version);
        onWritten(id);
        return { outcome: "saved", version, revision };
      }

      /** Deletes the file if it is still `baseVersion`; otherwise leaves it as it is. */
      function remove(file: MemoryFile, baseVersion: string): void {
        if (read(file).text?.version !== baseVersion) return;
        rmSync(pathOf(file));
        revisions.memoryRevision(id, file, null);
        onWritten(id);
      }

      return {
        dir,
        read,
        write,
        remove,

        /** When the file last changed on disk, in epoch ms; null when there is no such file. */
        modifiedAt: (file: MemoryFile): number | null => statSync(pathOf(file), { throwIfNoEntry: false })?.mtimeMs ?? null,

        /** Every memory file: the core ones that exist, in their order, then the rest by name. */
        list(): MemoryFile[] {
          const names = existsSync(dir) ? markdownUnder(dir) : [];
          const others = names.filter((file) => !CORE_FILES.includes(file)).sort();
          return [...CORE_FILES.filter((file) => names.includes(file)), ...others];
        },

        /**
         * Writes each core file but GOAL.md that doesn't exist yet, and GOAL.md whole: the goal exactly
         * as the user typed it, over one a start that failed before its thread existed wrote. Run as
         * the regional manager starts, before anyone else writes its memory.
         */
        seed(goal: string): void {
          for (const [file, text] of seedFiles()) write(file, text, null);
          const current = read(GOAL_FILE).text;
          if (current?.content !== goal) write(GOAL_FILE, goal, current?.version ?? null);
        },
      };
    },
  };
}

const versionOf = (content: string): string => createHash("sha256").update(content).digest("hex").slice(0, 16);

// why a temp file and a rename: a rename replaces the file in one step, so a crash leaves the old
// file whole, never half of the new one. The temp file sits beside it (a rename never crosses a
// disk) and ends in `.tmp`, so no memory file name can ever name it.
function writeWhole(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temp, content);
  renameSync(temp, path);
}

function markdownUnder(dir: string): MemoryFile[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile()) return [];
    const name = memoryFileSchema.safeParse(relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"));
    return name.success ? [name.data] : [];
  });
}

const GOAL_FILE = memoryFileSchema.parse("GOAL.md");

function seedFiles(): [MemoryFile, string][] {
  return Object.entries(SEEDS).map(([name, text]) => [memoryFileSchema.parse(name), text]);
}

/** MEMORY.md as the plugin writes it: one line per core file but itself, saying what goes in it. */
export const MEMORY_INDEX = `# Memory

The index of this memory. Each file holds one kind of thing; the work itself, who holds it, where it stands, what blocks it and what was decided, lives in the issues:

- GOAL.md: the goal this work was started with.
- NOTES.md: the regional manager's plan, its reasoning and durable lessons, never what an issue already says.
- AGENTS.md: the user's standing rules for the regional manager.
- CREW.md: rules every agent follows.
`;

/** Each core file but GOAL.md, as the plugin first writes it. */
export const SEEDS = {
  "MEMORY.md": MEMORY_INDEX,
  "NOTES.md": "# Notes\n\nNothing yet.\n",
  "AGENTS.md": "# Rules for the regional manager\n\nOne rule per line: the date, then the user's words.\n",
  "CREW.md": "# Crew rules\n\nNone yet.\n",
};
