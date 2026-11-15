import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { coordinatorIdSchema } from "../../model/role.ts";
import { memoryFileSchema, openMemoryRoot } from "./memory-files.ts";

const ID = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");

function freshMemory() {
  return openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-memory-")), "data.db")).of(ID);
}

test("seeding writes the six core files, with the goal in GOAL.md", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");

  assert.deepEqual(readdirSync(memory.dir).sort(), ["CREW.md", "DIGEST.md", "GOAL.md", "MEMORY.md", "PLAN.md", "PREFERENCES.md"]);
  assert.equal(readFileSync(join(memory.dir, "GOAL.md"), "utf8"), "# Goal\n\nMigrate the webhook service\n");
});

test("seeding again keeps every file as it is", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  writeFileSync(join(memory.dir, "PLAN.md"), "# Plan\n\n1. Inventory the endpoints\n");
  memory.seed("Something else");

  assert.equal(readFileSync(join(memory.dir, "PLAN.md"), "utf8"), "# Plan\n\n1. Inventory the endpoints\n");
  assert.match(readFileSync(join(memory.dir, "GOAL.md"), "utf8"), /Migrate the webhook service/);
});

test("a catch-up past its budget names the files it left out", () => {
  const memory = freshMemory();
  memory.seed("Migrate the webhook service");
  writeFileSync(join(memory.dir, "PLAN.md"), "x".repeat(45_000));

  const text = memory.catchUp();
  assert.match(text, /## GOAL\.md/);
  assert.doesNotMatch(text, /## PLAN\.md/);
  assert.match(text, /Not shown, to keep this short: PLAN\.md\./);
});

test("a memory file name stays inside the folder and ends in .md", () => {
  for (const name of ["GOAL.md", "notes/api.md", "notes/../PLAN.md"]) assert.ok(memoryFileSchema.safeParse(name).success, name);
  for (const name of ["../x.md", "/abs/x.md", "notes.txt", "..", "notes/../../x.md"]) assert.ok(!memoryFileSchema.safeParse(name).success, name);
});
