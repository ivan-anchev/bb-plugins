import assert from "node:assert/strict";
import fs, { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { test } from "node:test";
import { memoryFileSchema, type MemoryFile } from "../../model/memory-file.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { freshStore, MANAGER as ID, OTHER_MANAGER } from "../store/test-store.ts";
import { openMemoryRoot } from "./memory-files.ts";

const PLAN = memoryFileSchema.parse("PLAN.md");

function freshMemory() {
  const writes: string[] = [];
  const { store } = freshStore();
  const memory = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-memory-")), "data.db"), store, (id) => writes.push(id)).of(ID);
  return Object.assign(memory, { writes });
}

const versionOf = (memory: ReturnType<typeof freshMemory>, file: MemoryFile) => memory.read(file).text?.version ?? null;
const revisionOf = (memory: ReturnType<typeof freshMemory>, file: MemoryFile) => memory.read(file).revision;

test("seeding writes the six core files, with the goal in GOAL.md and MEMORY.md indexing them in the plugin's words", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");

  assert.deepEqual(readdirSync(memory.dir).sort(), ["CREW.md", "DIGEST.md", "GOAL.md", "MEMORY.md", "PLAN.md", "PREFERENCES.md"]);
  assert.equal(readFileSync(join(memory.dir, "GOAL.md"), "utf8"), "# Goal\n\nMigrate the webhook service\n");
  assert.match(readFileSync(join(memory.dir, "MEMORY.md"), "utf8"), /^- CREW\.md: rules every agent follows\.$/m);
});

test("seeding again keeps every file as it is", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  writeFileSync(join(memory.dir, "PLAN.md"), "# Plan\n\n1. Inventory the endpoints\n");
  memory.seed("Something else");

  assert.equal(readFileSync(join(memory.dir, "PLAN.md"), "utf8"), "# Plan\n\n1. Inventory the endpoints\n");
  assert.match(readFileSync(join(memory.dir, "GOAL.md"), "utf8"), /Migrate the webhook service/);
});

test("a write naming the file's current version replaces it and gives its new version", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");

  const outcome = memory.write(PLAN, "# Plan\n\n1. Inventory the endpoints\n", versionOf(memory, PLAN));
  assert.deepEqual(outcome, { outcome: "saved", version: versionOf(memory, PLAN), revision: revisionOf(memory, PLAN) });
  assert.equal(readFileSync(join(memory.dir, "PLAN.md"), "utf8"), "# Plan\n\n1. Inventory the endpoints\n");
});

test("a write with a stale version is refused, returns the current text, and leaves the file as it is", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const read = versionOf(memory, PLAN);
  memory.write(PLAN, "# Plan\n\n1. The user's step\n", read);

  const outcome = memory.write(PLAN, "# Plan\n\n1. The Coordinator's step\n", read);
  assert.deepEqual(outcome, { outcome: "conflict", current: memory.read(PLAN) });
  assert.equal(memory.read(PLAN).text?.content, "# Plan\n\n1. The user's step\n");
  assert.equal(readFileSync(join(memory.dir, "PLAN.md"), "utf8"), "# Plan\n\n1. The user's step\n");
});

test("a file edited on disk makes a write from the older version stale", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const read = versionOf(memory, PLAN);
  writeFileSync(join(memory.dir, "PLAN.md"), "# Plan\n\nEdited in vim\n");

  assert.equal(memory.write(PLAN, "# Plan\n\nOverwrite\n", read).outcome, "conflict");
  assert.equal(readFileSync(join(memory.dir, "PLAN.md"), "utf8"), "# Plan\n\nEdited in vim\n");
});

test("a write with no version creates a new file, and is refused once the file exists", () => {
  const memory = freshMemory();
  const api = memoryFileSchema.parse("notes/api.md");

  assert.equal(memory.write(api, "# API\n", null).outcome, "saved");
  assert.equal(readFileSync(join(memory.dir, "notes", "api.md"), "utf8"), "# API\n");
  assert.deepEqual(memory.write(api, "# Other\n", null), { outcome: "conflict", current: { text: { content: "# API\n", version: versionOf(memory, api) }, revision: revisionOf(memory, api) } });
});

test("a write to a file deleted since it was read is refused, saying it is gone", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const read = versionOf(memory, PLAN);
  fs.rmSync(join(memory.dir, "PLAN.md"));

  assert.deepEqual(memory.write(PLAN, "# Plan\n", read), { outcome: "conflict", current: { text: null, revision: revisionOf(memory, PLAN) } });
});

test("only a write that changed a file is announced", () => {
  const memory = freshMemory();
  memory.write(PLAN, "# Plan\n", null);
  memory.write(PLAN, "# Stale\n", null);

  assert.deepEqual(memory.writes, [ID]);
});

test("a write cut off between its temp file and its rename leaves the old file whole, and the temp file is never read as memory", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const before = memory.read(PLAN);
  const listed = memory.list();

  crashingOnRename(() => memory.write(PLAN, "# Plan\n\n1. Half of a new plan", before.text?.version ?? null));

  const leftover = readdirSync(memory.dir).filter((name) => !listed.some((file) => file === name));
  assert.equal(leftover.length, 1, "the crash leaves its temp file behind");
  assert.match(readFileSync(join(memory.dir, leftover[0] ?? ""), "utf8"), /Half of a new plan/);
  assert.equal(memoryFileSchema.safeParse(leftover[0]).success, false, "no memory file name reaches the temp file");
  assert.deepEqual(memory.read(PLAN), before);
  assert.deepEqual(memory.list(), listed);
});

test("a file keeps its revision while it stays the same, and every write that changes it gives the next", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const first = memory.read(PLAN);
  assert.deepEqual(memory.read(PLAN), first, "reading again changes nothing");

  const saved = memory.write(PLAN, "# Plan\n\n1. Inventory the endpoints\n", first.text?.version ?? null);
  assert.deepEqual(saved, { outcome: "saved", version: versionOf(memory, PLAN), revision: first.revision + 1 });
  assert.equal(revisionOf(memory, PLAN), first.revision + 1, "a read after the write sees its revision");

  const refused = memory.write(PLAN, "# Plan\n\nStale\n", first.text?.version ?? null);
  assert.deepEqual(refused, { outcome: "conflict", current: { text: memory.read(PLAN).text, revision: first.revision + 1 } }, "a refused write changes nothing");
});

test("a file edited on the server's disk gets its next revision when it is next read, even back to an earlier text", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const a = memory.read(PLAN);

  writeFileSync(join(memory.dir, "PLAN.md"), "# Plan\n\nEdited in vim\n");
  const b = memory.read(PLAN);
  assert.equal(b.text?.content, "# Plan\n\nEdited in vim\n");
  assert.equal(b.revision, a.revision + 1);

  writeFileSync(join(memory.dir, "PLAN.md"), a.text?.content ?? "");
  const back = memory.read(PLAN);
  assert.deepEqual(back.text, a.text, "the same text, and so the same version");
  assert.equal(back.revision, a.revision + 2, "but a later revision");

  fs.rmSync(join(memory.dir, "PLAN.md"));
  assert.deepEqual(memory.read(PLAN), { text: null, revision: a.revision + 3 }, "a deletion is a revision too");
});

test("an edit on disk that a write finds is the next revision, and the write's own is the one after", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  const a = memory.read(PLAN);
  writeFileSync(join(memory.dir, "PLAN.md"), "# Plan\n\nEdited in vim\n");

  const refused = memory.write(PLAN, "# Plan\n\nMine\n", a.text?.version ?? null);
  assert.deepEqual(refused, { outcome: "conflict", current: { text: { content: "# Plan\n\nEdited in vim\n", version: versionOf(memory, PLAN) }, revision: a.revision + 1 } });
  const saved = memory.write(PLAN, "# Plan\n\nMine\n", versionOf(memory, PLAN));
  assert.equal(saved.outcome === "saved" && saved.revision, a.revision + 2);
});

test("each coordinator's files count their revisions apart", () => {
  const { store } = freshStore();
  const root = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-memory-")), "data.db"), store, () => {});
  const other = OTHER_MANAGER;
  root.of(ID).write(PLAN, "# One\n", null);
  root.of(ID).write(PLAN, "# Two\n", root.of(ID).read(PLAN).text?.version ?? null);
  root.of(other).write(PLAN, "# One\n", null);

  assert.equal(root.of(ID).read(PLAN).revision, 3);
  assert.equal(root.of(other).read(PLAN).revision, 2);
  assert.equal(root.of(ID).read(memoryFileSchema.parse("GOAL.md")).revision, 1);
});

test("the list holds the core files in their order, then the rest by name, and nothing that isn't markdown", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  mkdirSync(join(memory.dir, "notes"));
  writeFileSync(join(memory.dir, "notes", "zones.md"), "");
  writeFileSync(join(memory.dir, "notes", "api.md"), "");
  writeFileSync(join(memory.dir, "scratch.txt"), "");

  assert.deepEqual(memory.list(), ["MEMORY.md", "GOAL.md", "PLAN.md", "PREFERENCES.md", "CREW.md", "DIGEST.md", "notes/api.md", "notes/zones.md"]);
});

test("a memory file name stays inside the folder, ends in .md, and has one spelling", () => {
  for (const name of ["GOAL.md", "notes/api.md", ".hidden.md"]) assert.ok(memoryFileSchema.safeParse(name).success, name);
  for (const name of ["../x.md", "/abs/x.md", "notes.txt", "..", "notes/../../x.md", "notes/../PLAN.md", "./PLAN.md", "notes//api.md", ".PLAN.md.1234.tmp"]) {
    assert.ok(!memoryFileSchema.safeParse(name).success, name);
  }
});

test("a name Windows reads as a path out of the folder, or as another file, is refused", () => {
  const dir = "C:\\bb\\memory\\coordinator";
  for (const name of ["..\\x.md", "notes\\..\\..\\x.md", "notes/..\\..\\x.md"]) {
    assert.ok(win32.relative(dir, win32.join(dir, name)).startsWith(".."), `${name} leaves the folder on Windows`);
    assert.ok(!memoryFileSchema.safeParse(name).success, name);
  }
  // A drive, a root or a stream: each names a file the name doesn't spell.
  for (const name of ["C:\\x.md", "C:x.md", "\\\\server\\share\\x.md", "\\PLAN.md", "notes\\api.md", "PLAN.md:x.md"]) {
    assert.ok(!memoryFileSchema.safeParse(name).success, name);
  }
});

// A crash, as the write sees it: the process stops after the temp file is written, before the
// rename runs. syncBuiltinESMExports carries the patched rename into memory-files' import.
function crashingOnRename(write: () => unknown): void {
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("killed");
  };
  syncBuiltinESMExports();
  try {
    assert.throws(write, /killed/);
  } finally {
    fs.renameSync = rename;
    syncBuiltinESMExports();
  }
}
