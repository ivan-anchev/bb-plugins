// The final check of a build parent end to end, through the tools as the regional manager and the
// verifier reach them and the tick as the server runs it. Each numbered test is one of issue 09's
// acceptance criteria; the rest are the races and changes around a check that runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import type { FinalCheck } from "../../../model/verdict/check.ts";
import { coordinating, HEAD, isRefusal, ISSUE, settled, textOf, threadIn } from "../../test-harness.ts";

const i1 = issueIdSchema.parse("i1");
const PARENT = { ...ISSUE, title: "Card vault", description: "Cards are stored in a vault, never in our database.", brief: "Split into sub-issues.", doneCriteria: ["npm run vault-suite passes on the default branch"] };
const SUB = { ...ISSUE, parent: "i1" };
/** origin's main once the sub-issues' pull requests merged; the local main stays at HEAD. */
const MERGED = "b".repeat(40);
const PASSES = { criteria: [{ criterion: 1, result: "pass", evidence: "$ npm run vault-suite\n# pass 21\n# fail 0" }], findings: [] };
const FAILS = { criteria: [{ criterion: 1, result: "fail", evidence: "$ npm run vault-suite\nnot ok 4 - tokens survive a restart\n# fail 1" }], findings: ["The vault client logs card numbers"] };
const CODEX = { providerId: "codex", model: "gpt-default" };

/** A regional manager with a build parent i1 and two build sub-issues i2 and i3, an agent at work on each (started with `start`), and the manager idle. */
async function withParent({ verify = true, parent = {}, start = {} }: { verify?: boolean; parent?: object; start?: object } = {}) {
  const { kit, threadId, coordinatorId } = await coordinating({ verify });
  const call = async (tool: string, input: object) => {
    const result = await kit.call(tool, input, threadId);
    return { refused: isRefusal(result), text: textOf(result) };
  };
  const text = async (tool: string, input: object) => (await call(tool, input)).text;
  const started = async (issue: string) => threadIn(await text("agent_start", { issue, ...start }));
  await text("issue_create", { ...PARENT, ...parent });
  await text("issue_create", { ...SUB, title: "Vault schema" });
  await text("issue_create", { ...SUB, title: "Vault client" });
  const builders = [await started("i2"), await started("i3")];
  kit.thread(threadId).status = "idle";
  let number = 40;
  /** The agent's pull request merges on GitHub, and origin's main moves to `tip`. */
  const merge = (agentThreadId: string, tip = MERGED) => {
    kit.github.prs.set(kit.thread(agentThreadId).environmentBranchName ?? assert.fail("no branch"), { number: ++number, state: "MERGED", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
    kit.repo.origin.set("main", tip);
  };
  /** The tick after GitHub changed: the PR watch reads it, the final checks' pass and the verifiers' follow. */
  const tick = async () => {
    kit.clock.now += 10 * 60_000;
    await kit.tick();
  };
  const finalChecks = (): FinalCheck[] => kit.store.finalChecks(coordinatorId, i1);
  const latest = (): FinalCheck => finalChecks().at(-1) ?? assert.fail("no final check");
  const verifier = (): string => {
    const { verdict } = latest();
    return verdict.state === "running" ? verdict.verifierThreadId : assert.fail(`the final check is ${verdict.state}`);
  };
  const row = async (id = "i1") => {
    const { status, headline, needsYou } = (await kit.rpc.board({ coordinatorId })).issues.find((issue) => issue.id === id) ?? assert.fail(`no row ${id}`);
    return { status, headline, needsYou };
  };
  const doorbells = () => kit.sent().flatMap((args) => (args.threadId === threadId ? args.input.flatMap((part) => (part.type === "text" ? [part.text] : [])) : []));
  /** Both sub-issues' pull requests merge, and a tick reads them. */
  const mergeAll = async () => {
    for (const builder of builders) merge(builder);
    await tick();
  };
  /** The final check's verifier returns `verdict` and ends its turn. */
  const returns = async (verdict: object) => {
    const thread = verifier();
    const answer = textOf(await kit.call("issue_verdict", verdict, thread));
    await kit.idle(thread, "Done.");
    await settled();
    return answer;
  };
  return { kit, threadId, coordinatorId, call, text, started, builders, merge, tick, finalChecks, latest, verifier, row, doorbells, mergeAll, returns };
}

const at = (status: string, headline: string | null, needsYou: string | null = null) => ({ status, headline, needsYou });

test("1: once every sub-issue is merged the parent's final check is due, and within the tick a hidden verifier, the manager's child, starts in a fresh worktree at origin's tip, on the parent's criteria", async () => {
  const { kit, threadId, builders, merge, tick, latest, verifier, row } = await withParent();
  merge(builders[0] ?? assert.fail());
  await tick();
  assert.deepEqual(await row(), at("in-progress", null), "one sub-issue still open");

  merge(builders[1] ?? assert.fail());
  // bb is slow to say what the default branch is: the check is due, not made yet.
  kit.environments.holding = true;
  const ticking = tick();
  await settled();
  assert.deepEqual(await row(), at("verifying", "Final check due"));
  kit.environments.holding = false;
  kit.environments.held.splice(0).forEach((release) => release());
  await ticking;

  assert.deepEqual(await row(), at("verifying", "Final check running"));
  const thread = kit.thread(verifier());
  assert.deepEqual(
    [thread.spawnedWith.parentThreadId, thread.spawnedWith.lifecycleOwnerThreadId, thread.spawnedWith.visibility, thread.spawnedWith.environment],
    [threadId, threadId, "hidden", { type: "host", hostId: "host_1", workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }],
  );
  assert.equal(kit.git.heads.get(kit.environment(thread.id)), MERGED, "origin's tip, though the local main is behind");
  assert.equal(kit.repo.local.get("main"), HEAD);
  assert.deepEqual([latest().criteria, latest().subject], [PARENT.doneCriteria, { kind: "final", defaultBranch: "main", merged: ["i2", "i3"] }]);
  assert.match(thread.spawnedWith.prompt ?? assert.fail("no brief"), /^# Final check of i1: Card vault\n\nEvery sub-issue of i1 is closed, and the work of i2, i3 is merged on main\./);
});

test("2: a final check that passes every criterion makes the parent Done, wakes the manager, and wakes it once about the issue its close unblocked", async () => {
  const { kit, text, mergeAll, returns, row, doorbells, tick } = await withParent();
  await text("issue_create", { ...ISSUE, title: "Charge saved cards", dependsOn: ["i1"] });
  await mergeAll();
  assert.match(await returns(PASSES), /^Verdict recorded: 1 of 1 criteria passed\./);
  assert.deepEqual(await row(), at("done", "✓ Final check passed"));
  await tick();
  await tick();
  assert.match(doorbells().join("\n"), /- i1 "Card vault" final check: passed/);
  const caughtUp = await text("crew_catch_up", {});
  assert.match(caughtUp, /### i1 "Card vault" final check\n\nAt [^\n]+ Final check of the merged work of i2, i3: Verified: 1 of 1 criteria passed on main at b{40}, by a verifier on codex gpt-default\. bb's git plugin read the verifier's worktree as it returned its verdict: commit b{40}, on a clean working tree\. Each result/);
  assert.match(caughtUp, /i1 is Done\./);
  assert.equal(caughtUp.match(/### i4 "Charge saved cards" is unblocked: i1 done/g)?.length, 1);
  await tick();
  assert.doesNotMatch(await text("crew_catch_up", {}), /is unblocked/, "once");
  assert.equal(kit.store.openChecks().length, 0);
});

test("3: a failed final check flags the parent, wakes the manager with a line that quotes nothing, sends nothing to any agent; a fix filed as a sub-issue puts it In progress, and once merged a new check starts by itself", async () => {
  const { kit, text, started, merge, mergeAll, returns, row, doorbells, finalChecks, latest, tick, builders } = await withParent();
  await mergeAll();
  const sentBefore = kit.sent().length;
  await returns(FAILS);
  await tick();
  assert.deepEqual(await row(), at("in-progress", "✗ Final check failed", "✗ Final check failed"));
  const line = doorbells().join("\n");
  assert.match(line, /- i1 "Card vault" final check: failed\n?/);
  assert.doesNotMatch(line, /vault-suite|card numbers|tokens survive/, "no word of the verifier's");
  assert.deepEqual(
    kit.sent().slice(sentBefore).filter(({ threadId }) => builders.includes(threadId)),
    [],
    "no message to any agent",
  );
  const caughtUp = await text("crew_catch_up", {});
  assert.match(caughtUp, /Final check of the merged work of i2, i3: Failed verification: 0 of 1 criteria passed on main at b{40}, by a verifier on codex gpt-default\./);
  assert.match(caughtUp, /not ok 4 - tokens survive a restart/);
  assert.match(caughtUp, /File the fix as a new sub-issue of i1 \(issue_create with parent "i1"\)/);

  await text("issue_create", { ...SUB, title: "Keep tokens across restarts" });
  assert.deepEqual(await row(), at("in-progress", null));
  const fixer = await started("i4");
  merge(fixer, "c".repeat(40));
  await tick();
  assert.equal(finalChecks().length, 2, "the failed one stays in the record");
  assert.equal(finalChecks()[0]?.verdict.state, "returned");
  assert.deepEqual(latest().subject.merged, ["i2", "i3", "i4"]);
  assert.equal(latest().verdict.state, "running");
  assert.deepEqual(await row(), at("verifying", "Final check running"));
});

test("4: two ticks, or a tick racing a sub-issue filed under the parent, never leave two open final checks", async () => {
  const twice = await withParent();
  await twice.mergeAll();
  await twice.tick();
  await twice.tick();
  assert.equal(twice.finalChecks().length, 1);
  assert.equal(twice.kit.store.openChecks().filter(({ issueId }) => issueId === "i1").length, 1);

  // The tick read the parent due, then waited on bb for the default branch while the manager filed a sub-issue.
  const filed = await withParent();
  for (const builder of filed.builders) filed.merge(builder);
  filed.kit.environments.holding = true;
  const ticking = filed.tick();
  await settled();
  assert.deepEqual(await filed.row(), at("verifying", "Final check due"));
  await filed.text("issue_create", { ...SUB, title: "Keep tokens across restarts" });
  filed.kit.environments.holding = false;
  filed.kit.environments.held.splice(0).forEach((release) => release());
  await ticking;
  assert.deepEqual(filed.finalChecks(), [], "the parent's turn read it again: no longer due");
  assert.deepEqual(await filed.row(), at("in-progress", null));

  // The parent's turn was reading its views when a sub-issue was written under it.
  const inTurn = await withParent();
  for (const builder of inTurn.builders) inTurn.merge(builder);
  inTurn.kit.environments.holding = true;
  const turnTicking = inTurn.tick();
  await settled();
  inTurn.kit.threadLists.holding = true;
  inTurn.kit.environments.holding = false;
  inTurn.kit.environments.held.splice(0).forEach((release) => release());
  await settled();
  assert.ok(inTurn.kit.threadLists.held.length > 0, "the parent's turn is reading its views");
  const filedMeanwhile = inTurn.kit.store.insertIssue(inTurn.coordinatorId, { kind: "build", title: "Keep tokens across restarts", description: ISSUE.description, brief: ISSUE.brief, doneCriteria: ISSUE.doneCriteria, verifier: null, rest: "todo", parentId: i1, dependsOn: [] }, new Map(), inTurn.kit.clock.now);
  assert.ok(!("refused" in filedMeanwhile));
  inTurn.kit.threadLists.holding = false;
  while (inTurn.kit.threadLists.held.length > 0) {
    inTurn.kit.threadLists.held.splice(0).forEach((release) => release());
    await settled();
  }
  await turnTicking;
  assert.deepEqual(inTurn.finalChecks(), [], "the write sent the read round again, and the parent is no longer due");
  assert.deepEqual(await inTurn.row(), at("in-progress", null));
});

test("5: a verifier that leaves a dirty tree fails the checkout rule; one idle without a verdict is nudged once, then could-not-run and Needs you; an unreadable worktree is could-not-run", async () => {
  const dirty = await withParent();
  await dirty.mergeAll();
  dirty.kit.git.changedFiles.set(dirty.kit.environment(dirty.verifier()), 1);
  await dirty.returns(PASSES);
  assert.deepEqual(await dirty.row(), at("in-progress", "✗ Final check failed", "✗ Final check failed"));
  assert.match(await dirty.text("crew_catch_up", {}), /Failed verification: the verifier's worktree wasn't clean\. 1 of 1 criteria passed on main at b{40}, by a verifier on codex gpt-default\. bb's git plugin read the verifier's worktree as it returned its verdict: the working tree had 1 changed file: \?\? scratch-1\.txt\./);

  const idle = await withParent();
  await idle.mergeAll();
  const verifier = idle.verifier();
  await idle.kit.idle(verifier, "Looked around.");
  await idle.tick();
  assert.deepEqual(
    idle.kit.sent().filter(({ threadId }) => threadId === verifier).map(({ senderThreadId }) => senderThreadId),
    [idle.threadId],
    "one reminder, from the manager's thread",
  );
  await idle.kit.idle(verifier, "Still looking.");
  await idle.tick();
  assert.equal(idle.latest().verdict.state, "could-not-run");
  assert.deepEqual(await idle.row(), at("in-progress", "Couldn't run its final check", "Couldn't run its final check"));
  assert.match(idle.doorbells().join("\n"), /- i1 "Card vault" final check: could not run/);

  const offline = await withParent();
  await offline.mergeAll();
  offline.kit.git.offline.add(offline.kit.environment(offline.verifier()));
  const refused = await offline.kit.call("issue_verdict", PASSES, offline.verifier());
  assert.ok(isRefusal(refused));
  assert.match(textOf(refused), /couldn't read your worktree \(.*offline.*\)/);
  assert.equal(offline.latest().verdict.state, "could-not-run");
  assert.deepEqual(await offline.row(), at("in-progress", "Couldn't run its final check", "Couldn't run its final check"));
});

test("6: with verification off no verifier starts, the parent waits In review unverified and is accepted; a research parent never gets a final check", async () => {
  const off = await withParent({ verify: false });
  const spawned = off.kit.spawned();
  await off.mergeAll();
  assert.equal(off.kit.spawned(), spawned, "no verifier");
  assert.deepEqual(await off.row(), at("in-review", "Unverified: verification was off"));
  assert.match(off.doorbells().join("\n"), /- i1 "Card vault" final check: not run, verification is off/);
  assert.equal(await off.text("issue_update", { id: "i1", status: "done" }), "Updated i1.");
  assert.deepEqual(await off.row(), at("done", "Accepted"));

  const { kit, threadId, coordinatorId } = await coordinating();
  const research = { kind: "research", title: "Pick a vault", description: "Which vault fits.", brief: "Compare them.", doneCriteria: [] };
  await kit.call("issue_create", research, threadId);
  await kit.call("issue_create", { ...research, title: "Vault", parent: "i1" }, threadId);
  const researcher = threadIn(textOf(await kit.call("agent_start", { issue: "i2" }, threadId)));
  await kit.call("agent_handoff", { status: "done", summary: "Vault", did: [], evidence: [], concerns: [], deviations: [], findings: [], report: "Vault." }, researcher);
  await kit.idle(researcher, "Handed off.");
  kit.clock.now += 10 * 60_000;
  await kit.tick();
  assert.equal((await kit.rpc.board({ coordinatorId })).issues[0]?.status, "done");
  assert.deepEqual(kit.store.finalChecks(coordinatorId, i1), []);
});

test("7: a build parent with no done-criteria when its check is due Needs you, and none starts until criteria are written", async () => {
  const { text, mergeAll, row, finalChecks, tick } = await withParent({ parent: { doneCriteria: [] } });
  await mergeAll();
  const none = "i1 has no done-criteria for its final check";
  assert.deepEqual(await row(), at("in-progress", none, none));
  await tick();
  assert.deepEqual(finalChecks(), []);
  await text("issue_update", { id: "i1", doneCriteria: ["npm run vault-suite passes on the default branch"] });
  assert.deepEqual(await row(), at("verifying", "Final check due"));
  await tick();
  assert.deepEqual(await row(), at("verifying", "Final check running"));
});

test("8: the final check runs on the parent's named verifier unless an agent of its merged work ran on it, else the manager's model, else another provider's; the verdict says which; renaming it mid-check applies to the next", async () => {
  const runsOn = (kit: Awaited<ReturnType<typeof withParent>>["kit"], threadId: string) => [kit.thread(threadId).providerId, kit.thread(threadId).execution?.model];

  const named = await withParent({ parent: { verifier: { providerId: "claude-code", model: "sonnet" } } });
  await named.mergeAll();
  assert.deepEqual(runsOn(named.kit, named.verifier()), ["claude-code", "sonnet"]);
  await named.returns(PASSES);
  assert.match(await named.text("crew_catch_up", {}), /by a verifier on claude-code sonnet, as named on i1\./);

  const theirs = await withParent({ parent: { verifier: CODEX }, start: { execution: CODEX } });
  await theirs.mergeAll();
  assert.deepEqual(runsOn(theirs.kit, theirs.verifier()), ["claude-code", "opus"], "the manager's, as the named one made the merged work");
  await theirs.returns(PASSES);
  assert.match(await theirs.text("crew_catch_up", {}), /by a verifier on claude-code opus, not the codex gpt-default named on i1: a1 did the work on it\./);

  const managers = await withParent();
  await managers.mergeAll();
  assert.deepEqual(runsOn(managers.kit, managers.verifier()), ["codex", "gpt-default"], "the agents ran on the manager's model");

  const alone = await withParent();
  alone.kit.providers.list = [{ id: "claude-code", available: true, models: [{ model: "opus", isDefault: true, defaultReasoningEffort: "high" }] }];
  await alone.mergeAll();
  assert.deepEqual(runsOn(alone.kit, alone.verifier()), ["claude-code", "opus"]);
  await alone.returns(PASSES);
  assert.match(await alone.text("crew_catch_up", {}), /by a verifier on claude-code opus, a1's own model, as no other was available\./);

  const renamed = await withParent();
  await renamed.mergeAll();
  const running = renamed.verifier();
  assert.match(await renamed.text("issue_update", { id: "i1", verifier: { providerId: "claude-code", model: "sonnet" } }), /a check already running keeps its own\./);
  assert.equal(renamed.latest().verifier, null);
  assert.equal(renamed.verifier(), running);
  await renamed.returns(FAILS);
  await renamed.text("issue_create", { ...SUB, title: "Keep tokens across restarts" });
  renamed.merge(await renamed.started("i4"), "c".repeat(40));
  await renamed.tick();
  assert.deepEqual(runsOn(renamed.kit, renamed.verifier()), ["claude-code", "sonnet"]);
});

test("an opened parent sends its final checks, each with only what its detail shows; its row only its headline", async () => {
  const { kit, coordinatorId, mergeAll, returns } = await withParent();
  await mergeAll();
  await returns(FAILS);
  const { finalChecks } = await kit.rpc.issue({ coordinatorId, issueId: i1 });
  assert.equal(finalChecks.length, 1);
  const [shown = assert.fail("no final check")] = finalChecks;
  assert.deepEqual(Object.keys(shown).sort(), ["at", "defaultBranch", "verdict"]);
  assert.equal(shown.defaultBranch, "main");
  assert.deepEqual(Object.keys(shown.verdict).sort(), ["checkout", "criteria", "findings", "headSha", "sameModel", "settlement", "state", "verifierThreadId"], "no model");
  const row = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
  assert.deepEqual(Object.keys(row).sort(), ["agent", "blockedBy", "headline", "id", "kind", "needsYou", "parentId", "pr", "status", "subIssues", "title"]);
  assert.deepEqual((await kit.rpc.issue({ coordinatorId, issueId: issueIdSchema.parse("i2") })).finalChecks, [], "a sub-issue has none");
});

test("a verdict that arrives after a sub-issue was filed under the parent is kept, and closes nothing while that sub-issue is open; its merge makes the next check", async () => {
  const { text, started, merge, mergeAll, returns, row, finalChecks, latest, tick } = await withParent();
  await mergeAll();
  await text("issue_create", { ...SUB, title: "Keep tokens across restarts" });
  assert.match(await returns(PASSES), /^Verdict recorded/);
  assert.deepEqual(await row(), at("in-progress", null));
  merge(await started("i4"), "c".repeat(40));
  await tick();
  assert.equal(finalChecks().length, 2);
  assert.deepEqual(latest().subject.merged, ["i2", "i3", "i4"]);
  assert.deepEqual(await row(), at("verifying", "Final check running"));
});

test("a sub-issue merged while a final check runs supersedes it, and stops its verifier before the next starts", async () => {
  const { kit, text, started, merge, mergeAll, finalChecks, verifier, tick } = await withParent();
  await mergeAll();
  const first = verifier();
  // The manager filed and merged a fix before the verifier returned.
  await text("issue_create", { ...SUB, title: "Keep tokens across restarts" });
  merge(await started("i4"), "c".repeat(40));
  await tick();
  assert.deepEqual(finalChecks().map(({ verdict }) => verdict.state), ["superseded", "running"]);
  assert.equal(kit.thread(first).status, "idle", "stopped");
  assert.notEqual(verifier(), first);
  assert.ok(isRefusal(await kit.call("issue_verdict", PASSES, first)));
});

test("verification switched off while a final check runs leaves that check to finish: its pass closes the parent", async () => {
  const { kit, coordinatorId, mergeAll, returns, row } = await withParent();
  await mergeAll();
  await kit.rpc.setVerify({ coordinatorId, verify: false });
  await returns(PASSES);
  assert.deepEqual(await row(), at("done", "✓ Final check passed"));
});
