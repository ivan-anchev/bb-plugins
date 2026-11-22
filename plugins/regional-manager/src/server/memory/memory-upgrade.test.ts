import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { freshStore, MANAGER, OTHER_MANAGER } from "../store/test-store.ts";
import { openMemoryRoot, SEEDS } from "./memory-files.ts";
import { upgradeMemoryFrom040 } from "./memory-upgrade.ts";

/** MEMORY.md exactly as 0.4 seeded it. */
const INDEX_040 = `# Memory

The index of this memory. Each file holds one kind of thing:

- GOAL.md: the goal this work was started with.
- PLAN.md: the plan: what to delegate, in what order, and what is done.
- PREFERENCES.md: the user's standing preferences and rules.
- CREW.md: rules every agent follows.
- DIGEST.md: the latest summary for the user.
`;

const PLAN = "# Plan\n\n1. Inventory the endpoints\n2. Retire cron (WEB-4)\n";
const PREFERENCES = "# Preferences\n\n- 2026-11-02: build on codex gpt-5.4\n";
const CREW = "# Crew rules\n\n- Run npm run check before handing off.\n";

/** A memory root whose managers' folders hold `files`, as 0.4 left them on disk; and every manager a write refreshed. */
function memoryOf040(byManager: Record<string, Record<string, string>>) {
  const { store } = freshStore();
  const refreshed: string[] = [];
  const root = openMemoryRoot(join(mkdtempSync(join(tmpdir(), "coordinator-memory-")), "data.db"), store, (id) => refreshed.push(id));
  for (const [manager, files] of Object.entries(byManager)) {
    mkdirSync(join(root.dir, manager), { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(root.dir, manager, file), content);
  }
  const folder = (manager: string) => Object.fromEntries(readdirSync(join(root.dir, manager)).sort().map((file) => [file, readFileSync(join(root.dir, manager, file), "utf8")]));
  return { root, refreshed, folder };
}

const seeded040 = (extra: Record<string, string> = {}) => ({ "MEMORY.md": INDEX_040, "GOAL.md": "Migrate the webhook service", "PLAN.md": PLAN, "PREFERENCES.md": PREFERENCES, "CREW.md": CREW, "DIGEST.md": "# Digest\n\nAll quiet.\n", ...extra });

test("0.4's memory upgrades whole: PLAN.md becomes NOTES.md and PREFERENCES.md RULES.md with their content, DIGEST.md goes, and MEMORY.md indexes today's files", () => {
  const { root, folder, refreshed } = memoryOf040({ [MANAGER]: seeded040() });
  upgradeMemoryFrom040(root, [MANAGER]);

  assert.deepEqual(folder(MANAGER), {
    "CREW.md": CREW,
    "GOAL.md": "Migrate the webhook service",
    "MEMORY.md": SEEDS["MEMORY.md"],
    "NOTES.md": "# Notes\n\n1. Inventory the endpoints\n2. Retire cron (WEB-4)\n",
    "RULES.md": "# Rules for the regional manager\n\n- 2026-11-02: build on codex gpt-5.4\n",
  });
  assert.ok(refreshed.length > 0 && refreshed.every((id) => id === MANAGER), "each change refreshes the manager's memory");
  assert.equal(root.of(MANAGER).read(memoryFileSchema.parse("PLAN.md")).text, null);
});

test("a PLAN.md and PREFERENCES.md still as 0.4 seeded them become NOTES.md and RULES.md exactly as seeded today", () => {
  const plan040 = "# Plan\n\nNo plan yet.\n";
  const preferences040 = "# Preferences\n\nOne rule per line: the date, then the user's words.\n";
  const { root, folder } = memoryOf040({ [MANAGER]: seeded040({ "PLAN.md": plan040, "PREFERENCES.md": preferences040 }) });
  upgradeMemoryFrom040(root, [MANAGER]);

  const files = folder(MANAGER);
  assert.equal(files["NOTES.md"], SEEDS["NOTES.md"]);
  assert.equal(files["RULES.md"], SEEDS["RULES.md"]);
});

test("a heading the user reworded, and every line but 0.4's own, move as they are", () => {
  const plan = "## Plan for the migration\n\n# Plan\n\n- keep # Plan here\n";
  const preferences = "# My rules\n\n- Always one PR per issue.\n";
  const { root, folder } = memoryOf040({ [MANAGER]: seeded040({ "PLAN.md": plan, "PREFERENCES.md": preferences }) });
  upgradeMemoryFrom040(root, [MANAGER]);

  const files = folder(MANAGER);
  assert.equal(files["NOTES.md"], "## Plan for the migration\n\n# Notes\n\n- keep # Plan here\n");
  assert.equal(files["RULES.md"], preferences);
});

test("a line the user added to MEMORY.md, and one they reworded, stay as they are", () => {
  const added = "- notes/api.md: what each endpoint returns.";
  const reworded = "- DIGEST.md: my own summary, kept by hand.";
  const index = INDEX_040.replace("- DIGEST.md: the latest summary for the user.", reworded).concat(`${added}\n`);
  const { root, folder } = memoryOf040({ [MANAGER]: seeded040({ "MEMORY.md": index }) });
  upgradeMemoryFrom040(root, [MANAGER]);

  const upgraded = folder(MANAGER)["MEMORY.md"] ?? "";
  assert.match(upgraded, /^- NOTES\.md: /m);
  assert.match(upgraded, /^- RULES\.md: /m);
  assert.doesNotMatch(upgraded, /PLAN\.md|PREFERENCES\.md/);
  assert.ok(upgraded.includes(`${reworded}\n`) && upgraded.endsWith(`${added}\n`), upgraded);
});

test("a move whose new file exists already leaves both files as they are", () => {
  const { root, folder } = memoryOf040({ [MANAGER]: seeded040({ "NOTES.md": "# Notes\n\nWritten by hand\n", "RULES.md": "# Mine\n" }) });
  upgradeMemoryFrom040(root, [MANAGER]);

  const files = folder(MANAGER);
  assert.equal(files["PLAN.md"], PLAN);
  assert.equal(files["NOTES.md"], "# Notes\n\nWritten by hand\n");
  assert.equal(files["PREFERENCES.md"], PREFERENCES);
  assert.equal(files["RULES.md"], "# Mine\n");
  assert.equal(files["DIGEST.md"], undefined);
});

test("a move cut short after writing the new file is finished by the next run, which removes the old one", () => {
  const { root, folder } = memoryOf040({ [MANAGER]: seeded040({ "NOTES.md": "# Notes\n\n1. Inventory the endpoints\n2. Retire cron (WEB-4)\n" }) });
  upgradeMemoryFrom040(root, [MANAGER]);

  const files = folder(MANAGER);
  assert.equal(files["PLAN.md"], undefined);
  assert.equal(files["NOTES.md"], "# Notes\n\n1. Inventory the endpoints\n2. Retire cron (WEB-4)\n");
});

test("a second run changes nothing, and memory seeded today is never touched", () => {
  const { root, folder, refreshed } = memoryOf040({ [MANAGER]: seeded040() });
  upgradeMemoryFrom040(root, [MANAGER]);
  const once = folder(MANAGER);
  const writes = refreshed.length;

  root.of(OTHER_MANAGER).seed("Retire the cron box");
  const seeded = folder(OTHER_MANAGER);
  const seedWrites = refreshed.length;
  upgradeMemoryFrom040(root, [MANAGER, OTHER_MANAGER]);

  assert.deepEqual(folder(MANAGER), once);
  assert.deepEqual(folder(OTHER_MANAGER), seeded);
  assert.equal(refreshed.length, seedWrites, "nothing is written");
  assert.ok(seedWrites > writes);
});

test("a manager with no memory folder yet, as one not started, is passed over", () => {
  const { root, refreshed } = memoryOf040({});
  upgradeMemoryFrom040(root, [MANAGER]);
  assert.deepEqual(refreshed, []);
});
