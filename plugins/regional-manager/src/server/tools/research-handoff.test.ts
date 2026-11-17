// A research issue end to end, through the tools as the regional manager, its agents and the user's
// Memory editor reach them: its report is its result, nothing verifies it, and the report is saved
// as a file in the manager's memory, which the plugin gives to nobody.
import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import { memoryStorage } from "../memory-storage.ts";
import { failWrites } from "../store/test-store.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn } from "../test-harness.ts";

const RESEARCH = {
  kind: "research",
  title: "Pick a card vault",
  description: "Which vault fits our PCI scope.",
  brief: "Compare HashiCorp Vault and AWS KMS for storing saved cards.",
  doneCriteria: ["Which one fits our PCI scope, and why?", "What does it cost a month at our volume?"],
};
const FIELDS = { summary: "Vault fits our PCI scope", did: ["Read both vendors' PCI guides"], evidence: [], concerns: [], deviations: [], findings: [] };
const REPORT = "## Recommendation\n\nVault: it keeps card data inside our PCI scope.\n\n## Cost\n\nAbout $400 a month.";
const DONE = { status: "done", ...FIELDS, report: REPORT };
const I1 = issueIdSchema.parse("i1");
const I1_REPORT = memoryFileSchema.parse("reports/i1.md");

/** A regional manager over `storage`, with research issue i1 filed (RESEARCH, with `fields` over it) and an agent started on it. */
async function researching(fields: object = {}, storage = memoryStorage().storage) {
  const { kit, threadId, coordinatorId } = await coordinating({ storage });
  const call = (tool: string, input: object) => kit.call(tool, input, threadId);
  assert.equal(textOf(await call("issue_create", { ...RESEARCH, ...fields })), "Filed i1 (research) in Todo.");
  const agentThreadId = threadIn(textOf(await call("agent_start", { issue: "i1" })));
  const files = kit.memory.of(coordinatorId);
  /** The status line issue_read gives: its kind, status and why. */
  const statusOf = async (id: string) => textOf(await call("issue_read", { id })).split("\n\n")[1] ?? "";
  const catchUp = async () => textOf(await call("crew_catch_up", {}));
  /** The agent ends its turn, as bb announces it; its handoff, if any, is then what places the issue. */
  const handOff = async (input: object) => {
    const result = await kit.call("agent_handoff", input, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
    return result;
  };
  return { kit, threadId, coordinatorId, agentThreadId, call, files, statusOf, catchUp, handOff };
}

test("a research issue files and starts with no questions, and its agent's first message asks for a report, not done-criteria", async () => {
  const { kit, agentThreadId } = await researching({ doneCriteria: [] });
  const prompt = kit.thread(agentThreadId).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /Your work is this issue: its brief below, and a report you hand off as your result\./);
  assert.doesNotMatch(prompt, /## Done when|## Questions/);
  assert.match(prompt, /## Handing off\n\nYour result is your report\. When it is written, call agent_handoff with status done and report: [^\n]*It names no commit: nothing you commit or push is read, and no verifier checks your work\./);
});

test("a research agent's first message lists its questions under \"Questions your report answers\"; a build agent's keeps \"Done when\" and no report", async () => {
  const { kit, threadId, agentThreadId } = await researching();
  const prompt = kit.thread(agentThreadId).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(prompt, /## Questions your report answers\n\nAnswer each one in your report:\n\n1\. Which one fits our PCI scope, and why\?\n2\. What does it cost a month at our volume\?\n\n## Handing off/);
  assert.doesNotMatch(prompt, /## Done when/);

  await kit.call("issue_create", ISSUE, threadId);
  const build = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));
  const buildPrompt = kit.thread(build).spawnedWith.prompt ?? assert.fail("spawned without a prompt");
  assert.match(buildPrompt, /## Done when\n\nEvery one of these holds, each checked by running something:\n\n1\. npm test passes/);
  assert.doesNotMatch(buildPrompt, /## Questions|## Handing off|report/);
});

test("a research done handoff is Done at once: no verifier, no git read, a commit given anyway dropped, and the manager woken to read the report whole with its file", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, files, statusOf, catchUp, handOff } = await researching();
  const spawned = kit.spawned();
  const result = await handOff({ ...DONE, headSha: HEAD, prUrl: "https://github.com/acme/webhooks/pull/7" });
  assert.equal(textOf(result), "Handed off. Your regional manager has your report, and i1 is Done: nothing verifies a research issue. Stop here.");
  await settled();

  assert.equal(kit.spawned(), spawned, "a verifier thread was spawned");
  assert.deepEqual(kit.git.calls.filter((call) => call.includes(kit.thread(agentThreadId).environmentId)), [], "the agent's checkout was read");
  const { handoff, check } = kit.store.record(coordinatorId, I1)[0] ?? assert.fail("no handoff stored");
  assert.equal(check, null);
  assert.deepEqual(handoff.status === "done" && handoff.delivery, { kind: "report", report: REPORT, file: I1_REPORT });
  assert.equal(await statusOf("i1"), `Research. Done: Handed off: Vault fits our PCI scope. Thread: @thread:${agentThreadId}, branch \`bb/${agentThreadId}\`.`);

  const doorbell = kit.sent().filter((args) => args.threadId === threadId).at(-1)?.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("") ?? "";
  assert.match(doorbell, /- i1 "Pick a card vault" \(a1\) handed off: done$/);
  const caughtUp = await catchUp();
  assert.ok(caughtUp.includes(`### i1 "Pick a card vault" (a1) handed off: done`), caughtUp);
  assert.ok(caughtUp.includes(`#### Report\n\nSaved in your memory as reports/i1.md. The plugin gives it to no agent: name the file in the brief of an agent that needs it, which reads it with crew_memory_read.\n\n${REPORT}`), caughtUp);
  assert.doesNotMatch(caughtUp, /Commit:|Pull request:/);
  assert.equal(files.read(I1_REPORT).text?.content, `${REPORT}\n`);
});

test("a research done handoff without a report is refused and saves nothing; so is a build one without its commit", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, files } = await researching();
  const refused = await kit.call("agent_handoff", { ...DONE, report: undefined, headSha: HEAD }, agentThreadId);
  assert.ok(isRefusal(refused));
  assert.equal(textOf(refused), "agent_handoff is refused and nothing was saved: A done handoff of a research issue needs report: your report, in markdown. It names no commit.");

  await kit.call("issue_create", ISSUE, threadId);
  const build = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));
  const commitless = await kit.call("agent_handoff", { status: "done", ...FIELDS }, build);
  assert.equal(textOf(commitless), "agent_handoff is refused and nothing was saved: A done handoff needs headSha: the output of `git rev-parse HEAD` after your last commit.");

  assert.deepEqual([...kit.store.record(coordinatorId, I1), ...kit.store.record(coordinatorId, issueIdSchema.parse("i2"))], []);
  assert.deepEqual(kit.store.unannounced(coordinatorId), []);
  assert.ok(!files.list().some((file) => file.startsWith("reports/")));
});

test("a message to the research agent puts the issue In progress, its next done handoff Done again, and archiving its thread then leaves it Done", async () => {
  const { kit, agentThreadId, call, statusOf, handOff } = await researching();
  await handOff(DONE);
  assert.match(await statusOf("i1"), /^Research\. Done: /);

  assert.equal(textOf(await call("agent_message", { agent: "a1", text: "Add what KMS would cost." })), "Sent to a1.");
  assert.match(await statusOf("i1"), /^Research\. In progress: Working\./);
  await handOff({ ...DONE, summary: "Vault fits; KMS costs more" });
  assert.match(await statusOf("i1"), /^Research\. Done: Handed off: Vault fits; KMS costs more\./);

  kit.thread(agentThreadId).archivedAt = Date.now();
  await kit.tick();
  assert.match(await statusOf("i1"), /^Research\. Done: Handed off: Vault fits; KMS costs more\./);
});

test("a research issue can't be accepted Done by the manager, and nothing can name a verifier on one", async () => {
  const { coordinatorId, call, kit } = await researching();
  const accept = await call("issue_update", { id: "i1", status: "done" });
  assert.ok(isRefusal(accept));
  assert.match(textOf(accept), /^i1 is In progress \([^)]*\), so it can't be marked Done: only an issue In review can\.$/);

  const verified = await call("issue_create", { ...RESEARCH, verifier: { providerId: "codex", model: "gpt-default" } });
  assert.equal(textOf(verified), "No issue filed: a research issue has no verifier: nothing verifies it. Leave verifier out.");
  const named = await call("issue_update", { id: "i1", verifier: { providerId: "codex", model: "gpt-default" } });
  assert.equal(textOf(named), "i1 can't be changed so: a research issue has no verifier: nothing verifies it. Give verifier: null with the change to drop the one named.");

  assert.equal(textOf(await call("issue_create", { ...ISSUE, verifier: { providerId: "codex", model: "gpt-default" } })), "Filed i2 (build) in Todo. Its done handoffs are checked on codex gpt-default (low).");
  const toResearch = await call("issue_update", { id: "i2", kind: "research" });
  assert.equal(textOf(toResearch), "i2 can't be changed so: a research issue has no verifier: nothing verifies it. Give verifier: null with the change to drop the one named.");
  assert.equal(textOf(await call("issue_update", { id: "i2", kind: "research", verifier: null })), "Updated i2. i2's verifier is the plugin's pick again.");
  assert.deepEqual(
    kit.store.issues(coordinatorId).map(({ id, kind, verifier }) => [id, kind, verifier]),
    [
      ["i1", "research", null],
      ["i2", "research", null],
    ],
  );
});

test("an issue's kind changes only until an agent has started on it, even one that has since stopped", async () => {
  const { coordinatorId, call, kit } = await researching();
  const held = await call("issue_update", { id: "i1", kind: "build" });
  assert.equal(textOf(held), "An agent has started on i1, so its kind stays research. File a new issue of the other kind instead.");
  await call("agent_stop", { agent: "a1" });
  assert.equal(textOf(await call("issue_update", { id: "i1", kind: "build" })), "An agent has started on i1, so its kind stays research. File a new issue of the other kind instead.");
  assert.equal(kit.store.issue(coordinatorId, I1)?.kind, "research");
});

test("the report is a memory file another agent reads with crew_memory_read, and an agent started later gets none of it unless its brief names it", async () => {
  const { kit, threadId, coordinatorId, handOff } = await researching();
  await handOff(DONE);
  assert.ok((await kit.rpc.memoryList({ coordinatorId })).files.includes(I1_REPORT));

  await kit.call("issue_create", { ...ISSUE, title: "Card vault schema", brief: "Store saved cards. Read reports/i1.md with crew_memory_read first." }, threadId);
  const builder = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));
  await kit.call("issue_create", { ...ISSUE, title: "Dead letters" }, threadId);
  const other = threadIn(textOf(await kit.call("agent_start", { issue: "i3" }, threadId)));

  assert.ok(textOf(await kit.call("crew_memory_read", { file: "reports/i1.md" }, builder)).includes(REPORT));
  for (const agent of [builder, other]) assert.ok(!(kit.thread(agent).spawnedWith.prompt ?? "").includes("inside our PCI scope"), "the report reached an agent's first message");
  assert.match(kit.thread(builder).spawnedWith.prompt ?? "", /Read reports\/i1\.md with crew_memory_read first\./);
});

test("a later report replaces the file the plugin saved, and one deleted since is saved again", async () => {
  const { call, files, handOff } = await researching();
  await handOff(DONE);
  await call("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  await handOff({ ...DONE, report: "## Recommendation\n\nVault, still." });
  assert.equal(files.read(I1_REPORT).text?.content, "## Recommendation\n\nVault, still.\n");

  rmSync(join(files.dir, I1_REPORT));
  await call("agent_message", { agent: "a1", text: "Once more." });
  await handOff({ ...DONE, report: "## Recommendation\n\nVault, finally." });
  assert.equal(files.read(I1_REPORT).text?.content, "## Recommendation\n\nVault, finally.\n");
  assert.deepEqual(
    files.list().filter((file) => file.startsWith("reports/")),
    [I1_REPORT],
  );
});

test("a report file edited in the Memory editor is kept: a later report goes beside it, and catch-up says where and why", async () => {
  const { kit, coordinatorId, call, files, catchUp, handOff } = await researching();
  await handOff(DONE);
  await catchUp();
  const { version } = files.read(I1_REPORT).text ?? assert.fail("no report file");
  const edited = `${REPORT}\n\nUser: we go with Vault.\n`;
  assert.equal((await kit.rpc.memoryWrite({ coordinatorId, file: I1_REPORT, content: edited, baseVersion: version })).outcome, "saved");

  for (const [n, report] of [[2, "## Recommendation\n\nVault, still."], [3, "## Recommendation\n\nVault, finally."]] as const) {
    await call("agent_message", { agent: "a1", text: "Look again." });
    const result = await handOff({ ...DONE, report });
    assert.match(textOf(result), /^Handed off\. Your regional manager has your report, and i1 is Done/);
    assert.equal(files.read(memoryFileSchema.parse(`reports/i1-${n}.md`)).text?.content, `${report}\n`);
    assert.ok((await catchUp()).includes(`#### Report\n\nSaved in your memory as reports/i1-${n}.md. reports/i1.md is not as the plugin last saved it there (someone edited or wrote it), so it is kept as it is.`));
  }
  assert.equal(files.read(I1_REPORT).text?.content, edited);
});

test("a report file someone wrote before the plugin saved any is kept, and a report that can't be saved stores nothing", async () => {
  const { kit, coordinatorId, files, handOff } = await researching();
  assert.equal(files.write(I1_REPORT, "# My own notes on i1\n", null).outcome, "saved");
  await handOff(DONE);
  assert.equal(files.read(I1_REPORT).text?.content, "# My own notes on i1\n");
  assert.equal(files.read(memoryFileSchema.parse("reports/i1-2.md")).text?.content, `${REPORT}\n`);

  // The file it would go to can't be read: a folder stands where it is.
  const { kit: other, coordinatorId: otherId, agentThreadId, files: otherFiles } = await researching();
  mkdirSync(join(otherFiles.dir, "reports", "i1.md"), { recursive: true });
  await assert.rejects(other.call("agent_handoff", DONE, agentThreadId), /EISDIR/);
  assert.deepEqual(other.store.record(otherId, I1), []);
  assert.deepEqual(other.store.unannounced(otherId), []);
  assert.equal(kit.store.record(coordinatorId, I1).length, 1);
});

test("issue_read shows a research issue's questions, that nothing verifies it, and its report in the record", async () => {
  const { call, handOff } = await researching();
  await handOff(DONE);
  const read = textOf(await call("issue_read", { id: "i1" }));
  assert.ok(read.includes("### Questions\n\n1. Which one fits our PCI scope, and why?\n2. What does it cost a month at our volume?"), read);
  assert.ok(read.includes("### Verifier\n\nNone: nothing verifies a research issue."), read);
  assert.ok(read.includes(`#### Report\n\nSaved in your memory as reports/i1.md.`) && read.includes(REPORT), read);
  assert.doesNotMatch(read, /### Done when/);
});

/** The reports/ files in the manager's memory, each with what it holds. */
const reportFiles = (files: Awaited<ReturnType<typeof researching>>["files"]) => files.list().flatMap((file) => (file.startsWith("reports/") ? [[file, files.read(file).text?.content]] : []));

test("a first report whose handoff can't be stored leaves no file, and its retry saves it to reports/i1.md with its handoff and event", async () => {
  const { db, storage } = memoryStorage();
  const { kit, coordinatorId, agentThreadId, files, catchUp } = await researching({}, storage);
  const allow = failWrites(db, "INSERT", "events");
  await assert.rejects(kit.call("agent_handoff", DONE, agentThreadId), /forced failure/);
  assert.deepEqual(reportFiles(files), []);
  assert.deepEqual(kit.store.record(coordinatorId, I1), []);
  assert.doesNotMatch(await catchUp(), /handed off/);

  allow();
  assert.match(textOf(await kit.call("agent_handoff", DONE, agentThreadId)), /^Handed off\. Your regional manager has your report, and i1 is Done/);
  assert.deepEqual(reportFiles(files), [[I1_REPORT, `${REPORT}\n`]]);
  assert.deepEqual(
    kit.store.record(coordinatorId, I1).map(({ handoff }) => handoff.status === "done" && handoff.delivery),
    [{ kind: "report", report: REPORT, file: I1_REPORT }],
  );
  const caughtUp = await catchUp();
  assert.equal(caughtUp.split(`### i1 "Pick a card vault" (a1) handed off: done`).length, 2, caughtUp);
  assert.ok(caughtUp.includes(`#### Report\n\nSaved in your memory as reports/i1.md. The plugin gives`), caughtUp);
});

test("a later report whose handoff can't be stored puts the earlier one back, and its retry replaces it in reports/i1.md, not beside it", async () => {
  const { db, storage } = memoryStorage();
  const { kit, coordinatorId, agentThreadId, call, files, catchUp, handOff } = await researching({}, storage);
  await handOff(DONE);
  await catchUp();
  await call("agent_message", { agent: "a1", text: "Add what KMS would cost." });
  const later = { ...DONE, summary: "Vault fits; KMS costs more", report: "## Recommendation\n\nVault: KMS costs more." };

  const allow = failWrites(db, "INSERT", "events");
  await assert.rejects(kit.call("agent_handoff", later, agentThreadId), /forced failure/);
  assert.deepEqual(reportFiles(files), [[I1_REPORT, `${REPORT}\n`]]);
  assert.deepEqual(
    kit.store.record(coordinatorId, I1).map(({ handoff }) => handoff.summary),
    ["Vault fits our PCI scope"],
  );
  assert.doesNotMatch(await catchUp(), /handed off/);

  allow();
  await handOff(later);
  assert.deepEqual(reportFiles(files), [[I1_REPORT, "## Recommendation\n\nVault: KMS costs more.\n"]]);
  assert.deepEqual(
    kit.store.record(coordinatorId, I1).map(({ handoff }) => handoff.status === "done" && handoff.delivery.kind === "report" && [handoff.summary, handoff.delivery.file]),
    [
      ["Vault fits our PCI scope", I1_REPORT],
      ["Vault fits; KMS costs more", I1_REPORT],
    ],
  );
  const caughtUp = await catchUp();
  assert.equal(caughtUp.split(`### i1 "Pick a card vault" (a1) handed off: done`).length, 2, caughtUp);
  assert.ok(caughtUp.includes(`#### Report\n\nSaved in your memory as reports/i1.md. The plugin gives`), caughtUp);
  assert.doesNotMatch(caughtUp, /not as the plugin last saved it/);
});

test("a report whose handoff is stored keeps its file when the doorbell after it fails", async () => {
  const { kit, threadId, coordinatorId, statusOf, handOff, files } = await researching();
  kit.sends.failure = { threadId, error: new Error("bb is restarting"), taken: false };
  await handOff(DONE);
  await settled();
  assert.ok(kit.sendAttempts().includes(threadId), "no doorbell was tried");
  assert.deepEqual(reportFiles(files), [[I1_REPORT, `${REPORT}\n`]]);
  assert.equal(kit.store.record(coordinatorId, I1).length, 1);
  assert.match(await statusOf("i1"), /^Research\. Done: /);
});
