import assert from "node:assert/strict";
import { test } from "node:test";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { InteractionPayload } from "../../model/interaction.ts";
import type { Review } from "../../model/verdict/review.ts";
import { memoryStorage } from "../memory-storage.ts";
import { MIGRATIONS } from "../store/migrations.ts";
import { coordinating, HEAD, isRefusal, settled, startedAgent, textOf, threadIn } from "../test-harness.ts";

const a1 = agentIdSchema.parse("a1");
const CRITERIA = ["npm test passes", "npm run lint prints no errors"];
const DONE = { status: "done", summary: "Retries land with backoff", did: ["Added exponential backoff"], evidence: ["npm test: 12 passing, trust me"], concerns: [], deviations: [], findings: [], headSha: HEAD };
const PASSES = {
  criteria: [
    { criterion: 1, result: "pass", evidence: "$ npm test\n# pass 13" },
    { criterion: 2, result: "pass", evidence: "$ npm run lint\n0 problems" },
  ],
  findings: [],
};
const FAILS = { ...PASSES, criteria: [{ criterion: 1, result: "fail", evidence: "$ npm test\nnot ok 13" }, PASSES.criteria[1]] };
const FINDINGS = [
  { file: "src/retry.ts", line: 42, severity: "must-fix", claim: "The backoff never caps, so a dead endpoint is retried every 2^n ms forever." },
  { file: "src/retry.ts", line: null, severity: "nit", claim: "The retry helper's name says nothing about backoff." },
];
const CREW = "# Crew rules\n\n- Reviewers: run the house review against REVIEW.md and report what it finds.\n- Keep every folder at nine files or fewer.\n";

/** A regional manager with one agent on WEB-1, both idle, whose reviewers the test drives (`reportAtOnce` off). */
async function withAgent(options: Parameters<typeof coordinating>[0] = {}) {
  const { kit, threadId, coordinatorId } = await coordinating(options);
  kit.reviewers.reportAtOnce = false;
  const { agentThreadId } = await startedAgent(kit, threadId, { title: "Add retries", brief: "Retry failed deliveries with backoff.", doneCriteria: CRITERIA });
  kit.thread(threadId).status = "idle";
  const row = async () => {
    const issue = (await kit.rpc.board({ coordinatorId })).issues[0] ?? assert.fail("no row");
    return [laneOf(issue), issue.headline];
  };
  const check = () => kit.store.latestHandoff(coordinatorId, a1)?.check ?? assert.fail("no check");
  const review = (): Review => check().review;
  const reviewer = (): string => {
    const now = review();
    return now.state === "running" ? now.reviewerThreadId : assert.fail(`the review is ${now.state}`);
  };
  const verifier = (): string => {
    const now = check().verdict;
    return now.state === "running" ? now.verifierThreadId : assert.fail(`the verdict is ${now.state}`);
  };
  /** The agent hands off as done and ends its turn. */
  async function handOff(input: object = DONE): Promise<void> {
    await kit.call("agent_handoff", input, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
  }
  /** The running reviewer reports `findings` and ends its turn; returns issue_review's answer. */
  async function reported(findings: readonly object[]): Promise<string> {
    const threadId = reviewer();
    const answer = textOf(await kit.call("issue_review", { findings }, threadId));
    await kit.idle(threadId, "Reviewed.");
    return answer;
  }
  /** The running verifier returns `report` and ends its turn. */
  async function returned(report: object): Promise<void> {
    const threadId = verifier();
    assert.match(textOf(await kit.call("issue_verdict", report, threadId)), /^Verdict recorded/);
    await kit.idle(threadId, "Verdict returned.");
  }
  const catchUp = async () => textOf(await kit.call("crew_catch_up", {}, threadId));
  return { kit, threadId, coordinatorId, agentThreadId, row, check, review, reviewer, verifier, handOff, reported, returned, catchUp };
}

test("with verification on, a done handoff is Reviewing once its agent is idle, Verifying once its reviewer reports, then its verdict places it; with it off, neither stage runs", async () => {
  const { kit, agentThreadId, row, check, review, verifier, reported, returned } = await withAgent();
  await kit.call("agent_handoff", DONE, agentThreadId);
  assert.deepEqual(await row(), ["in-progress", "Working"], "the turn that handed off still runs");
  assert.deepEqual([review(), check().verdict.state], [{ state: "queued" }, "queued"], "no reviewer runs beside its agent");
  await kit.idle(agentThreadId, "Handed off.");

  assert.deepEqual(await row(), ["reviewing", "Reviewing: Retries land with backoff"]);
  assert.equal(review().state, "running");
  assert.equal(check().verdict.state, "queued", "no verifier while its review is to come");

  assert.equal(await reported([]), "Review recorded: no findings. A verifier triages them next. Stop here; don't change anything in this environment.");
  assert.deepEqual(await row(), ["verifying", "Verifying: Retries land with backoff"]);
  verifier();

  await returned(PASSES);
  assert.deepEqual(await row(), ["in-review", "✓ Verified: Retries land with backoff"]);

  const off = await withAgent({ verify: false });
  const spawned = off.kit.spawned();
  await off.handOff();
  assert.deepEqual([off.kit.spawned(), off.review(), off.check().verdict.state], [spawned, { state: "none" }, "waived"], "no reviewer and no verifier");
  assert.deepEqual(await off.row(), ["in-review", "Unverified: Retries land with backoff"]);
});

test("a reviewer is a hidden, read-only child of the agent in its environment, and its first message is the plugin's one line, the diff, the issue's brief and criteria, and CREW.md whole", async () => {
  const { kit, coordinatorId, agentThreadId, reviewer, handOff } = await withAgent();
  const files = kit.memory.of(coordinatorId);
  const crewFile = memoryFileSchema.parse("CREW.md");
  assert.equal(files.write(crewFile, CREW, files.read(crewFile).text?.version ?? null).outcome, "saved");
  await handOff({ ...DONE, prUrl: "https://github.com/acme/webhooks/pull/7" });

  const { spawnedWith, execution } = kit.thread(reviewer());
  assert.deepEqual(
    [spawnedWith.visibility, spawnedWith.parentThreadId, spawnedWith.environment, spawnedWith.title, execution?.permissionMode],
    ["hidden", agentThreadId, { type: "reuse", environmentId: kit.thread(agentThreadId).environmentId }, "Review WEB-1: Add retries", "auto"],
  );
  assert.deepEqual(kit.configurationFor(reviewer(), {}), {
    tools: ["crew_memory_read", "issue_review"],
    skills: ["crew-board"],
    instructions: kit.configurationFor(reviewer(), {}).instructions,
  });
  const prompt = spawnedWith.prompt ?? assert.fail("no prompt");
  const [opening, diff, brief, criteria, crew, rest] = prompt.split("\n\n## ").map((part, i) => (i === 0 ? part : `## ${part}`));
  assert.equal(opening, "# Review WEB-1: Add retries\n\nReview this diff as CREW.md instructs reviewers, and report through issue_review.");
  assert.equal(diff, `## The diff\n\nThe commits up to \`${HEAD}\`, checked out in this environment, that \`origin/main\` doesn't have (\`git diff origin/main...${HEAD}\`). Its pull request: https://github.com/acme/webhooks/pull/7.`);
  assert.equal(brief, "## The issue's brief\n\nRetry failed deliveries with backoff.");
  assert.equal(criteria, "## Done-criteria\n\n1. npm test passes\n2. npm run lint prints no errors");
  // why the title nested: CREW.md sits under the message's own section, as it does in an agent's first message.
  assert.equal(crew, `## CREW.md: the rules every agent follows\n\n${CREW.replace("# Crew rules", "### Crew rules").trimEnd()}`);
  assert.equal(rest, undefined, "nothing else: no review the plugin names, and none of the agent's report");
  assert.doesNotMatch(prompt, /trust me|Retries land with backoff/);
});

test("a reviewer runs on neither the agent's model nor the one its verifier then runs on; with no third, on the verifier's, never the agent's", async () => {
  const { kit, agentThreadId, reviewer, verifier, handOff, reported } = await withAgent();
  await handOff();
  const ranOn = (threadId: string) => `${kit.thread(threadId).providerId}/${kit.thread(threadId).execution?.model}`;
  assert.equal(ranOn(agentThreadId), "claude-code/opus");
  assert.equal(ranOn(reviewer()), "claude-code/sonnet");
  await reported([]);
  assert.equal(ranOn(verifier()), "codex/gpt-default");

  const alone = await withAgent();
  alone.kit.providers.list = alone.kit.providers.list.filter(({ id }) => id === "claude-code");
  await alone.handOff();
  const onlyOther = (threadId: string) => `${alone.kit.thread(threadId).providerId}/${alone.kit.thread(threadId).execution?.model}`;
  assert.equal(onlyOther(alone.reviewer()), "claude-code/sonnet");
  await alone.reported([]);
  assert.equal(onlyOther(alone.verifier()), "claude-code/sonnet", "the verifier on the one model that isn't the agent's, as the reviewer is");
});

test("with only the agent's own model to run, no reviewer starts: the review is missed as having no independent reviewer model, and the verifier starts, told no review was had", async () => {
  const { kit, coordinatorId, check, review, verifier, handOff, row } = await withAgent();
  kit.providers.list = [{ id: "claude-code", available: true, models: [{ model: "opus", isDefault: true, defaultReasoningEffort: "high" }] }];
  const spawned = kit.spawned();
  await handOff();
  const reason = "no independent reviewer model: bb can run none there but a1's own";
  assert.deepEqual(review(), { state: "missed", reviewerThreadId: null, reason });
  assert.deepEqual(
    kit.store.issueThreads(coordinatorId, check().issueId).map(({ kind }) => kind),
    ["agent", "verifier"],
    "no reviewer thread, on the agent's model or any other",
  );
  assert.equal(kit.spawned(), spawned + 1, "only the verifier");
  assert.deepEqual(await row(), ["verifying", "Verifying: Retries land with backoff"]);
  assert.match(kit.thread(verifier()).spawnedWith.prompt ?? "", new RegExp(`No review was had: ${reason}\\.`));
});

test("the verifier's brief lists the review's findings; its verdict triages each, and a failed one sends the agent only those it confirmed, with why", async () => {
  const { kit, agentThreadId, check, verifier, handOff, reported, catchUp } = await withAgent();
  await handOff();
  assert.equal(await reported(FINDINGS), "Review recorded: 2 findings. A verifier triages them next. Stop here; don't change anything in this environment.");
  const brief = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(brief, /## The reviewer's findings\n\nAn independent reviewer read the diff before you and claims these\. They are claims, not facts[^\n]*\n\n1\. `src\/retry\.ts:42` \(must-fix\): The backoff never caps, so a dead endpoint is retried every 2\^n ms forever\.\n2\. `src\/retry\.ts` \(nit\): The retry helper's name says nothing about backoff\./);

  const untriaged = await kit.call("issue_verdict", FAILS, verifier());
  assert.ok(isRefusal(untriaged));
  assert.equal(textOf(untriaged), "issue_verdict is refused and nothing was saved: triage every finding of the reviewer's; missing 1, 2 of 1 to 2.");
  const unknown = await kit.call("issue_verdict", { ...FAILS, triage: [1, 2, 3].map((finding) => ({ finding, result: "rejected", reason: "No." })) }, verifier());
  assert.equal(textOf(unknown), "issue_verdict is refused and nothing was saved: there are only 2 findings of the reviewer's; 3 is not one.");

  const triage = [
    { finding: 1, result: "confirmed", reason: "retry.ts:42 doubles the delay with no ceiling; a test with 20 failures waits 17 minutes." },
    { finding: 2, result: "rejected", reason: "A naming taste, not worth a fix round." },
  ];
  const verifierThreadId = verifier();
  await kit.call("issue_verdict", { ...FAILS, triage }, verifierThreadId);
  await kit.idle(verifierThreadId, "Verdict returned.");
  const sent = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(
    sent,
    /### Review findings the verifier confirmed\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps, so a dead endpoint is retried every 2\^n ms forever\.\n {2}The verifier: retry\.ts:42 doubles the delay with no ceiling; a test with 20 failures waits 17 minutes\.$/,
  );
  assert.doesNotMatch(sent, /helper's name|naming taste/, "a rejected finding never reaches the agent");
  assert.match(await catchUp(), /the verifier confirmed 1 and rejected 1\. The confirmed ones went back to the agent with the failed verdict\./);
  const stored = check().verdict;
  assert.deepEqual(stored.state === "returned" && stored.triage, [
    { result: "confirmed", reason: triage[0]?.reason },
    { result: "rejected", reason: triage[1]?.reason },
  ]);
});

test("the manager's update shows the review's confirmed findings and its rejected ones, each with the verifier's reason", async () => {
  const { handOff, reported, returned, catchUp } = await withAgent();
  await handOff();
  await reported(FINDINGS);
  await returned({ ...PASSES, triage: [{ finding: 1, result: "confirmed", reason: "It never caps." }, { finding: 2, result: "rejected", reason: "Taste." }] });
  await settled();
  const update = await catchUp();
  assert.match(update, /Review: a reviewer on claude-code sonnet reported 2 findings; the verifier confirmed 1 and rejected 1\. None of them went to the agent\./, "a passed verdict sends nothing back");
  assert.match(update, /Confirmed:\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps[^\n]*\n {2}Why: It never caps\./);
  assert.match(update, /Rejected:\n- `src\/retry\.ts` \(nit\): The retry helper's name says nothing about backoff\.\n {2}Why: Taste\./);
});

test("a reviewer silent for 30 minutes never holds the issue in Reviewing: it is stopped, the verifier starts, and the verdict says no review was had; 29 minutes is not enough", async () => {
  const { kit, row, review, reviewer, verifier, handOff, returned, catchUp } = await withAgent();
  await handOff();
  const reviewerThreadId = reviewer();
  kit.clock.now += 29 * 60_000;
  await kit.tick();
  await settled();
  assert.deepEqual([review().state, (await row())[0]], ["running", "reviewing"], "29 minutes");

  kit.clock.now += 60_000;
  await kit.tick();
  await settled();
  const reason = "its reviewer showed no activity for 30 minutes";
  assert.deepEqual(review(), { state: "missed", reviewerThreadId, reason });
  assert.equal(kit.thread(reviewerThreadId).status, "idle", "the reviewer no longer holds the agent's environment");
  assert.deepEqual(await row(), ["verifying", "Verifying: Retries land with backoff"]);
  assert.match(kit.thread(verifier()).spawnedWith.prompt ?? "", new RegExp(`## The review\n\nNo review was had: ${reason}\\. There is nothing to triage: pass triage as \\[\\]\\.`));

  await returned(PASSES);
  await settled();
  assert.match(await catchUp(), new RegExp(`Review: no review was had, as ${reason}\\.`));
});

test("a reviewer that ends its turn without reporting, or that bb won't start, never holds the issue in Reviewing: its verifier starts, told no review was had", async () => {
  const silent = await withAgent();
  await silent.handOff();
  await silent.kit.idle(silent.reviewer(), "I looked around.");
  assert.deepEqual(silent.review(), { state: "missed", reviewerThreadId: silent.kit.store.issueThreads(silent.coordinatorId, silent.check().issueId).at(-2)?.threadId ?? assert.fail(), reason: "its reviewer ended its turn without reporting" });
  assert.match(silent.kit.thread(silent.verifier()).spawnedWith.prompt ?? "", /No review was had: its reviewer ended its turn without reporting\./);

  const refused = await withAgent();
  let refusals = 1;
  // why one refusal: bb refuses the reviewer's spawn and takes the verifier's after it.
  Object.defineProperty(refused.kit.spawns, "answer", { get: () => (refusals-- > 0 ? "refused" : "thread") });
  await refused.handOff();
  assert.deepEqual(refused.review(), { state: "missed", reviewerThreadId: null, reason: "bb did not start a reviewer: HTTP 400: Invalid environment" });
  assert.deepEqual(await refused.row(), ["verifying", "Verifying: Retries land with backoff"]);
  refused.verifier();
});

const RECONNECT: InteractionPayload = { kind: "provider-codex/mcp-elicitation", title: "Reconnect GitHub on ChatGPT", data: null };

test("whatever a reviewer asks a person is declined, as nobody answers a reviewer, and it reviews on; an ask bb won't let the plugin decline misses the review, stops the reviewer and starts the verifier", async () => {
  const { kit, review, reviewer, verifier, handOff, reported } = await withAgent();
  await handOff();
  const asking = reviewer();
  await kit.ask(asking, RECONNECT);
  await settled();
  assert.deepEqual(kit.askAnswers.answered.map(({ threadId, how }) => [threadId, how]), [[asking, "decline"]]);
  assert.deepEqual([review(), kit.thread(asking).hasPendingInteraction], [{ state: "running", reviewerThreadId: asking }, false], "it reviews on");
  await reported([]);
  verifier();

  const refused = await withAgent();
  await refused.handOff();
  const stuck = refused.reviewer();
  refused.kit.askAnswers.refusal = new Error("bb is restarting");
  await refused.kit.ask(stuck, RECONNECT);
  await settled();
  assert.deepEqual(refused.review(), { state: "missed", reviewerThreadId: stuck, reason: 'its reviewer asked a person "Reconnect GitHub on ChatGPT", and bb refused the plugin\'s decline: bb is restarting' });
  assert.equal(refused.kit.thread(stuck).status, "idle", "the reviewer no longer holds the agent's environment");
  assert.deepEqual(await refused.row(), ["verifying", "Verifying: Retries land with backoff"]);
  assert.match(refused.kit.thread(refused.verifier()).spawnedWith.prompt ?? "", /No review was had: its reviewer asked a person "Reconnect GitHub on ChatGPT"/);
});

test("issue_review is refused to a thread that isn't the running reviewer of its check, and once its review was missed", async () => {
  const { kit, agentThreadId, reviewer, handOff } = await withAgent();
  assert.match(textOf(await kit.call("issue_review", { findings: [] }, agentThreadId)), /^issue_review is refused: only a reviewer thread the plugin started reports a review/);
  await handOff();
  const reviewerThreadId = reviewer();
  kit.clock.now += 30 * 60_000;
  await kit.tick();
  await settled();
  const late = await kit.call("issue_review", { findings: FINDINGS }, reviewerThreadId);
  assert.ok(isRefusal(late));
  assert.match(textOf(late), /^issue_review is refused and nothing was saved: this review no longer waits for your findings/);
});

/**
 * A storage whose migrations the test can roll back by one statement count, as a database the
 * release before reviews wrote: bb runs only the statements past the count it has recorded.
 */
function rollbackableStorage() {
  const { db } = memoryStorage();
  const migrated = { applied: 0 };
  const storage: Pick<PluginStorage, "database" | "migrate"> = {
    database: () => db,
    migrate(handle, statements) {
      statements.slice(migrated.applied).forEach((statement) => handle.exec(statement));
      migrated.applied = statements.length;
    },
  };
  return { db, storage, migrated };
}

test("issues stored before reviews, in every status, load with the same status, their checks with no review stage, and a check left queued gets its verifier, never a reviewer", async () => {
  const { db, storage, migrated } = rollbackableStorage();
  const { kit, threadId, coordinatorId } = await coordinating({ storage });
  const call = async (tool: string, input: object) => textOf(await kit.call(tool, input, threadId));
  const filed = async (fields: object) => /Filed ([A-Z]+-\d+)/.exec(await call("issue_create", { kind: "build", title: "Work", description: "Some work.", brief: "Do it.", doneCriteria: ["npm test passes"], ...fields }))?.[1] ?? assert.fail("not filed");
  const started = async (issue: string) => threadIn(await call("agent_start", { issue }));
  const handedOff = async (agentThreadId: string) => {
    await kit.call("agent_handoff", { ...DONE, summary: "Done" }, agentThreadId);
    await kit.idle(agentThreadId, "Handed off.");
  };
  const verdictOf = (issue: string) => kit.store.record(coordinatorId, issueIdSchema.parse(issue)).at(-1)?.check?.verdict;

  await filed({ status: "backlog" }); // WEB-1
  await filed({}); // WEB-2, Todo
  kit.thread(await started(await filed({}))).status = "active"; // WEB-3, In progress
  const verifying = await started(await filed({})); // WEB-4, Verifying: its verifier runs
  await handedOff(verifying);
  const reviewed = await started(await filed({})); // WEB-5, In review: verified
  await handedOff(reviewed);
  const passed = verdictOf("WEB-5");
  await kit.call("issue_verdict", { criteria: [{ criterion: 1, result: "pass", evidence: "ok" }], findings: [] }, passed?.state === "running" ? passed.verifierThreadId : assert.fail());
  await settled();
  await kit.call("issue_create", { kind: "research", title: "Pick a vault", description: "Which vault?", brief: "Compare two.", doneCriteria: [] }, threadId); // WEB-6
  const researcher = await started("WEB-6");
  await kit.call("agent_handoff", { status: "done", summary: "Vault picked", did: [], evidence: [], concerns: [], deviations: [], findings: [], report: "# Vault\n\nPick A." }, researcher);
  await kit.idle(researcher, "Reported.");
  await call("issue_update", { id: await filed({}), status: "canceled" }); // WEB-7
  const queued = await started(await filed({})); // WEB-8, In progress: its check queued while its agent's turn still runs
  await kit.call("agent_handoff", { ...DONE, summary: "Done" }, queued);

  const statuses = async () => (await kit.rpc.board({ coordinatorId })).issues.map(({ id, status }) => [id, status]);
  const before = await statuses();
  assert.deepEqual(before, [
    ["WEB-1", "backlog"],
    ["WEB-2", "todo"],
    ["WEB-3", "in-progress"],
    ["WEB-4", "verifying"],
    ["WEB-5", "in-review"],
    ["WEB-6", "done"],
    ["WEB-7", "canceled"],
    ["WEB-8", "in-progress"],
  ]);

  // As the release before reviews left it: no review column, no triage on a verdict, and its last migration still to run.
  db.exec("ALTER TABLE checks DROP COLUMN review");
  db.exec("UPDATE checks SET verdict = json_remove(verdict, '$.triage')");
  migrated.applied = MIGRATIONS.length - 1;
  kit.reload();

  assert.deepEqual(await statuses(), before);
  assert.deepEqual(
    kit.store.record(coordinatorId, issueIdSchema.parse("WEB-4")).map(({ check }) => check?.review),
    [{ state: "none" }],
  );
  const spawned = kit.spawned();
  await kit.idle(queued, "Handed off.");
  const started8 = verdictOf("WEB-8");
  assert.equal(started8?.state, "running", "its verifier starts at once");
  assert.equal(kit.spawned(), spawned + 1, "with no reviewer before it");
  assert.equal(kit.store.roleOfThread(started8?.state === "running" ? started8.verifierThreadId : "")?.kind, "verifier");
});
