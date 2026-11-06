// Which commands read as a `bb thread tell`. Every case was also run through bb's own recognizer
// (ThreadScreen bundle `po`, lifted out and run on the same command): where this says tell, bb
// says tell; the forms under "read as commands here" are the documented gap, which bb reads as tells.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { TimelineRow, WorkRow } from "./bb.ts";
import { isThreadTell } from "./thread-tell.ts";

type CommandRow = Extract<WorkRow, { workKind: "command" }>;

// A real completed command (see normalise.test.ts for how the fixture was taken), its text replaced.
const claude: { rows: TimelineRow[] } = JSON.parse(readFileSync(new URL("./fixtures/claude-thread.json", import.meta.url), "utf8"));
const base = commandRow();
const run = (command: string, exitCode: number | null = 0): boolean => isThreadTell({ ...base, command, exitCode });
const T = "thr_24dxq5xhph";

test("one plain invocation that ran well is a tell, quoted or not, by any path, with bb's options", () => {
  for (const command of [
    `bb thread tell ${T} "Done: see the report."`,
    `/usr/local/bin/bb thread message ${T} 'two\nlines'`,
    `FOO=1 bb thread tell --json --model gpt-5 ${T} hi`,
    `$BB_CLI thread tell --mode=plan ${T} hi`,
    `\${BB_CLI:-bb} thread tell ${T} hi`,
  ]) assert.ok(run(command), command);
});

test("a tell that failed or did not finish, a compound command, or a malformed tell is a command", () => {
  assert.ok(!run(`bb thread tell ${T} hi`, 1));
  assert.ok(!isThreadTell({ ...base, command: `bb thread tell ${T} hi`, status: "pending", exitCode: null }));
  for (const command of [
    `bb thread tell ${T} hi && echo sent`,
    `bb thread tell ${T} hi | cat`,
    `echo bb thread tell ${T} hi`,
    `bb thread tell thr_NOTANID00 hi`,
    `bb thread tell ${T}`,
    `bb thread tell ${T} hi extra`,
    `bb thread tell --unknown ${T} hi`,
    `bb thread tell ${T} '   '`,
    `bb thread tell ${T} "$MSG"`,
  ]) assert.ok(!run(command), command);
});

test("forms bb reads as tells but this does not read as commands here: a wrapper, a heredoc, a redirect, a trailing ;", () => {
  for (const command of [
    `bash -lc "bb thread tell ${T} hi"`,
    `bb thread tell ${T} --message-file - <<EOF\nhi\nEOF`,
    `bb thread tell ${T} hi > /dev/null`,
    `bb thread tell ${T} hi;`,
  ]) assert.ok(!run(command), command);
});

function commandRow(): CommandRow {
  const walk = (rows: readonly TimelineRow[]): TimelineRow[] =>
    rows.flatMap((row) => (row.kind === "turn" ? walk(row.children ?? []) : row.kind === "work" && row.workKind === "delegation" ? walk(row.childRows ?? []) : [row]));
  const row = walk(claude.rows).find((r): r is CommandRow => r.kind === "work" && r.workKind === "command" && r.status === "completed");
  return row ?? assert.fail("fixture premise: a completed command");
}
