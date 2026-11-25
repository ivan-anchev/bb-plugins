import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { laneOf } from "../../model/board/board-groups.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { decisionIdSchema } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { InteractionPayload } from "../../model/interaction.ts";
import type { Round } from "../../model/feed/round.ts";
import type { Review } from "../../model/verdict/review.ts";
import type { Verdict } from "../../model/verdict/verdict.ts";
import { memoryStorage } from "../memory-storage.ts";
import { MIGRATIONS } from "../store/migrations.ts";
import { failWrites } from "../store/test-store.ts";
import { coordinating, HEAD, isRefusal, levels, settled, startedAgent, textOf, threadIn, toCap } from "../test-harness.ts";

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
/** The verdict `stored` of a handoff that passed both its criteria, as the board shows it in its round, settled as `settlement`: no model, triage or rule's flag. */
function shownPassing(stored: Verdict, settlement: object) {
  if (stored.state !== "returned") return assert.fail("not returned");
  const criteria = PASSES.criteria.map(({ criterion, result, evidence }) => ({ criterion: CRITERIA[criterion - 1], result, evidence }));
  return { state: "returned", verifierThreadId: stored.verifierThreadId, headSha: HEAD, checkout: { headSha: HEAD, changedFiles: [], changedFileCount: 0 }, criteria, findings: [], sameModel: false, settlement };
}

/** What a round's verdict says it judged: its outcome, its criteria's results and its fix round (its step's time and status are the feed's, feed.test.ts). */
const judged = ({ verdict }: { verdict: Pick<NonNullable<Round["verdict"]>, "outcome" | "results" | "fixRound"> | null }) => {
  const { outcome, results, fixRound } = verdict ?? assert.fail("no verdict");
  return { outcome, results, fixRound };
};

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
  /** The round of the agent's latest handoff as the board opens it: its line and its body. */
  const opened = async () => (await kit.opened(coordinatorId, check().issueId)).rounds.at(-1) ?? assert.fail("no round");
  return { kit, threadId, coordinatorId, agentThreadId, row, check, review, reviewer, verifier, handOff, reported, returned, catchUp, opened };
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

test("a reviewer is a hidden, read-only child of the agent in its environment, and its first message is the plugin's lines, the diff, the issue's brief and criteria, and CREW.md whole; with no decisions on the issue, no Decisions heading", async () => {
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
  assert.match(opening, /^# Review WEB-1: Add retries\n\nReview this diff as CREW.md instructs reviewers, and report through issue_review\. CREW\.md says what to look for; this rule alone says what blocks\. A must-fix blocks the work only when/);
  assert.equal(diff, `## The diff\n\nThe commits up to \`${HEAD}\`, checked out in this environment, that \`origin/main\` doesn't have (\`git diff origin/main...${HEAD}\`). Its pull request: https://github.com/acme/webhooks/pull/7.`);
  assert.equal(brief, "## The issue's brief\n\nRetry failed deliveries with backoff.");
  assert.equal(criteria, "## Done-criteria\n\n1. npm test passes\n2. npm run lint prints no errors");
  // why the title nested: CREW.md sits under the message's own section, as it does in an agent's first message.
  assert.equal(crew, `## CREW.md: the rules every agent follows\n\n${CREW.replace("# Crew rules", "### Crew rules").trimEnd()}`);
  assert.equal(rest, undefined, "nothing else: no review the plugin names, no decisions, and none of the agent's report");
  assert.doesNotMatch(prompt, /trust me|Retries land with backoff/);
});

test("the reviewer's first message, its role's rules and issue_review's instructions each state the five anchors, that the brief is the issue's brief text, and that CREW.md says what to look for while the rule alone says what blocks", async () => {
  const { kit, reviewer, handOff } = await withAgent();
  await handOff();
  const tool = kit.tools().find(({ name }) => name === "issue_review") ?? assert.fail("no issue_review");
  const places = {
    "first message": kit.thread(reviewer()).spawnedWith.prompt ?? assert.fail("no prompt"),
    "role's rules": kit.configurationFor(reviewer(), {}).instructions ?? assert.fail("no rules"),
    "issue_review's instructions": tool.instructions ?? assert.fail("no instructions"),
  };
  assert.match(places["first message"], /Report each finding at the severity CREW\.md gives it, a must-fix that breaks none of the five included: the verifier anchors or downgrades it, never you\./);
  assert.match(places["role's rules"], /report each finding at the severity it gives, a must-fix that breaks none of the five below included/);
  assert.match(
    JSON.stringify(z.toJSONSchema(tool.parameters)),
    /must-fix: the severity CREW\.md gives a finding\. Report it as must-fix even when it breaks none of the five things below, and say in the claim which it breaks, or that it breaks none: the verifier anchors or downgrades it, never you\./,
    "issue_review's severity field keeps a CREW.md must-fix a must-fix",
  );
  for (const [place, text] of Object.entries(places)) {
    assert.match(text, /CREW\.md says what to look for[^\n]*(this|the anchor|The anchor) rule alone says what blocks/, place);
    assert.ok(
      text.includes(
        "A must-fix blocks the work only when it breaks one of five things: a done-criterion, the issue's brief, a recorded decision, safety (data loss, a crash or a security hole), or existing behaviour, as a regression. The brief is the issue's brief text: a CREW.md or REVIEW.md rule blocks only when the brief or a done-criterion names it. Work that follows a recorded decision is never a finding.",
      ),
      place,
    );
  }
});

test("a reviewer's first message holds the issue's decisions under a Decisions heading, before CREW.md: a recorded one and an answered question, never the plugin's own answered question at the cap", async () => {
  const { kit, threadId, coordinatorId, agentThreadId } = await withAgent();
  kit.reviewers.reportAtOnce = true;
  const a2Thread = await toCap(kit, threadId, coordinatorId, "WEB-1", agentThreadId);
  kit.reviewers.reportAtOnce = false;
  await kit.rpc.answerDecision({ coordinatorId, decisionId: decisionIdSchema.parse("d1"), answer: "One more round" });
  await kit.call("crew_ask_user", { question: "Cap the backoff at five minutes?", options: ["Yes", "No"], issue: "WEB-1" }, threadId);
  await kit.rpc.answerDecision({ coordinatorId, decisionId: decisionIdSchema.parse("d2"), answer: "Yes" });
  await kit.call("issue_update", { id: "WEB-1", decision: "Keep the helper named retry: the user's call." }, threadId);
  await kit.startTurn(a2Thread);
  await kit.call("agent_handoff", DONE, a2Thread);
  await kit.idle(a2Thread, "Handed off.");
  await settled();

  const review = kit.store.latestHandoff(coordinatorId, agentIdSchema.parse("a2"))?.check?.review;
  const prompt = kit.thread(review?.state === "running" ? review.reviewerThreadId : assert.fail(`the review is ${review?.state}`)).spawnedWith.prompt ?? assert.fail("no prompt");
  const sections = prompt.split("\n\n## ");
  const at = sections.findIndex((part) => part.startsWith("Decisions on WEB-1"));
  assert.deepEqual([sections[at - 1]?.split("\n")[0], sections[at + 1]?.split("\n")[0]], ["Done-criteria", "CREW.md: the rules every agent follows"], "after the criteria, before CREW.md");
  const decisions = sections[at] ?? assert.fail("no Decisions heading");
  assert.match(decisions, /^Decisions on WEB-1\n\nWhat the user and the regional manager decided about this issue: the decisions recorded on it, and the user's answers to the questions put to them\. They are part of the work, as its brief is: work that follows one is never a finding, and a must-fix that breaks one breaks a recorded decision\. A question not answered yet decides nothing\.\n\nOldest first; where two disagree, the later one wins\.\n\n/);
  assert.match(decisions, /\n- [^\n]+: asked the user \(d2\): Cap the backoff at five minutes\? They answered at [^\n]+: Yes\n- [^\n]+: Keep the helper named retry: the user's call\.$/);
  assert.doesNotMatch(decisions, /d1|One more round|failed verification/, "the question at the cap is no decision about the work");
});

test("an issue_update that changes the brief and records a decision while a reviewer's or a verifier's setup reads bb reaches its first message whole: the new brief beside the new decision, never the old brief", async () => {
  const { kit, threadId, reviewer, verifier, handOff, reported } = await withAgent();
  /** While bb is slow to list the models a checker can run on, the manager rewrites WEB-1's brief and records a decision in one issue_update. */
  async function editedDuringSetup(start: () => Promise<void>, brief: string, decision: string): Promise<void> {
    kit.providers.holding = true;
    await start();
    assert.ok(kit.providers.held.length > 0, "the setup reads the catalog");
    const updated = await kit.call("issue_update", { id: "WEB-1", brief, decision }, threadId);
    assert.ok(!isRefusal(updated), textOf(updated));
    kit.providers.holding = false;
    kit.providers.held.splice(0).forEach((release) => release());
    await settled();
  }
  const sectionsOf = (prompt: string) => ({ brief: /\n## The issue's brief(?:, for context)?\n\n([^\n]*)/.exec(prompt)?.[1], decisions: prompt.match(/^- [^\n]+$/gm) ?? [] });

  await editedDuringSetup(() => handOff(), "Retry failed deliveries with capped backoff.", "Cap the backoff at five minutes.");
  const review = sectionsOf(kit.thread(reviewer()).spawnedWith.prompt ?? assert.fail("no prompt"));
  assert.equal(review.brief, "Retry failed deliveries with capped backoff.", "the reviewer's brief is the one the decision came with");
  assert.equal(review.decisions.filter((line) => line.endsWith("Cap the backoff at five minutes.")).length, 1);

  await editedDuringSetup(async () => void (await reported([])), "Retry failed deliveries with backoff capped at five minutes.", "Jitter is out of scope.");
  const verify = sectionsOf(kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt"));
  assert.equal(verify.brief, "Retry failed deliveries with backoff capped at five minutes.", "the verifier's brief is the one the latest decision came with");
  assert.equal(verify.decisions.filter((line) => line.endsWith("Jitter is out of scope.")).length, 1);
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

test("the reviewer and verifier the plugin picks run at high, else at the highest level their model lists below high, never their catalog default", async () => {
  const { kit, reviewer, verifier, handOff, reported } = await withAgent();
  await handOff();
  const ranAt = (threadId: string) => `${kit.thread(threadId).providerId}/${kit.thread(threadId).execution?.model} at ${kit.thread(threadId).execution?.reasoningLevel}`;
  assert.equal(ranAt(reviewer()), "claude-code/sonnet at high", "sonnet's default is medium");
  await reported([]);
  assert.equal(ranAt(verifier()), "codex/gpt-default at high", "gpt-default's default is low");

  const noHigh = await withAgent();
  noHigh.kit.providers.list = [
    {
      id: "claude-code",
      available: true,
      models: [
        { model: "opus", isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: levels("low", "medium", "high", "max") },
        { model: "sonnet", isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: levels("low", "medium") },
      ],
    },
    { id: "codex", available: true, models: [{ model: "gpt-mini", isDefault: true, defaultReasoningEffort: "low", supportedReasoningEfforts: levels("minimal", "low", "medium") }] },
  ];
  await noHigh.handOff();
  const lowerAt = (threadId: string) => `${noHigh.kit.thread(threadId).providerId}/${noHigh.kit.thread(threadId).execution?.model} at ${noHigh.kit.thread(threadId).execution?.reasoningLevel}`;
  assert.equal(lowerAt(noHigh.reviewer()), "claude-code/sonnet at medium");
  await noHigh.reported([]);
  assert.equal(lowerAt(noHigh.verifier()), "codex/gpt-mini at medium");
});

test("with only the agent's own model to run, no reviewer starts: the review is missed as having no independent reviewer model, and the verifier starts, told no review was had", async () => {
  const { kit, coordinatorId, check, review, verifier, handOff, row } = await withAgent();
  kit.providers.list = [{ id: "claude-code", available: true, models: [{ model: "opus", isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: levels("low", "medium", "high", "max") }] }];
  const spawned = kit.spawned();
  await handOff();
  const reason = "no independent reviewer model: bb can run none there but a1's own";
  assert.deepEqual(review(), { state: "missed", at: kit.clock.now, reviewerThreadId: null, reason });
  assert.deepEqual(
    kit.store.issueThreads(coordinatorId, check().issueId).map(({ kind }) => kind),
    ["agent", "verifier"],
    "no reviewer thread, on the agent's model or any other",
  );
  assert.equal(kit.spawned(), spawned + 1, "only the verifier");
  assert.deepEqual(await row(), ["verifying", "Verifying: Retries land with backoff"]);
  assert.match(kit.thread(verifier()).spawnedWith.prompt ?? "", new RegExp(`No review was had: ${reason}\\.`));
});

test("the verifier's brief lists the review's findings; its verdict triages each, and a failed one sends the agent only those that held, with the verifier's word and why", async () => {
  const { kit, agentThreadId, check, verifier, handOff, reported, catchUp } = await withAgent();
  await handOff();
  assert.equal(await reported(FINDINGS), "Review recorded: 2 findings. A verifier triages them next. Stop here; don't change anything in this environment.");
  const brief = kit.thread(verifier()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(brief, /## The reviewer's findings\n\nAn independent reviewer read the diff before you and claims these\. They are claims, not facts[^\n]*Only an anchored must-fix fails the verdict, as a failed criterion does, even when every criterion passes[^\n]*\n\n1\. `src\/retry\.ts:42` \(must-fix\): The backoff never caps, so a dead endpoint is retried every 2\^n ms forever\.\n2\. `src\/retry\.ts` \(nit\): The retry helper's name says nothing about backoff\./);

  const untriaged = await kit.call("issue_verdict", FAILS, verifier());
  assert.ok(isRefusal(untriaged));
  assert.equal(textOf(untriaged), "issue_verdict is refused and nothing was saved: triage every finding of the reviewer's; missing 1, 2 of 1 to 2.");
  const unknown = await kit.call("issue_verdict", { ...FAILS, triage: [1, 2, 3].map((finding) => ({ finding, result: "rejected", reason: "No." })) }, verifier());
  assert.equal(textOf(unknown), "issue_verdict is refused and nothing was saved: there are only 2 findings of the reviewer's; 3 is not one.");

  const triage = [
    { finding: 1, result: "anchored", anchor: "criterion", reason: "retry.ts:42 doubles the delay with no ceiling; a test with 20 failures waits 17 minutes." },
    { finding: 2, result: "rejected", reason: "A naming taste, not worth a fix round." },
  ];
  const verifierThreadId = verifier();
  await kit.call("issue_verdict", { ...FAILS, triage }, verifierThreadId);
  await kit.idle(verifierThreadId, "Verdict returned.");
  const sent = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(
    sent,
    /### Must-fix review findings the verifier upheld\n\nEach of these fails the verdict on its own, whatever the done-criteria say\.\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps, so a dead endpoint is retried every 2\^n ms forever\.\n {2}The verifier: Anchored, as it breaks a done-criterion\. retry\.ts:42 doubles the delay with no ceiling; a test with 20 failures waits 17 minutes\.$/,
  );
  assert.doesNotMatch(sent, /helper's name|naming taste/, "a rejected finding never reaches the agent");
  assert.match(await catchUp(), /the verifier anchored 1, downgraded 0, confirmed 0 and rejected 1\. The ones that held went back to the agent with the failed verdict\./);
  const stored = check().verdict;
  assert.deepEqual(stored.state === "returned" && stored.triage, [
    { ...FINDINGS[0], origin: "new", result: "anchored", anchor: "criterion", reason: triage[0]?.reason },
    { ...FINDINGS[1], origin: "new", result: "rejected", reason: triage[1]?.reason },
  ]);
});

test("a verdict that passes every criterion but anchors a must-fix finding fails: the finding goes back to the agent with the verifier's reason as its fix round, a downgraded one beside it at its lower severity, and the manager's update names the anchored one as the cause", async () => {
  const { kit, threadId, coordinatorId, agentThreadId, row, check, handOff, reported, returned, catchUp, opened } = await withAgent();
  await handOff();
  await reported([...FINDINGS, { file: "src/retry.ts", line: 3, severity: "must-fix", claim: "The imports break REVIEW.md's order." }]);
  await returned({
    ...PASSES,
    triage: [
      { finding: 1, result: "anchored", anchor: "brief", reason: "It never caps: 20 failures wait 17 minutes." },
      { finding: 2, result: "rejected", reason: "Taste." },
      { finding: 3, result: "downgraded", to: "nit", reason: "Neither the brief nor a criterion names REVIEW.md's import order." },
    ],
  });
  await settled();

  const stored = check().verdict;
  assert.deepEqual(stored.state === "returned" && [stored.criteria.map(({ result }) => result), stored.settlement], [["pass", "pass"], { kind: "sent-back", round: 1, ci: { kind: "none" } }], "every criterion passed, and it went back as fix round 1");
  assert.deepEqual(await row(), ["in-progress", "Working"], "its agent works on its fix round");

  const sent = kit.delivered(agentThreadId).at(-1) ?? assert.fail("nothing reached the agent");
  assert.match(sent, /^## Verifier findings: a must-fix review finding upheld, though every done-criterion passed\n/);
  assert.match(
    sent,
    /### Must-fix review findings the verifier upheld\n\nEach of these fails the verdict on its own, whatever the done-criteria say\.\n\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps, so a dead endpoint is retried every 2\^n ms forever\.\n {2}The verifier: Anchored, as it breaks the issue's brief\. It never caps: 20 failures wait 17 minutes\.$/m,
  );
  assert.match(
    sent,
    /### Other review findings that held\n\n- `src\/retry\.ts:3` \(must-fix\): The imports break REVIEW\.md's order\.\n {2}The verifier: Downgraded to nit\. Neither the brief nor a criterion names REVIEW\.md's import order\.$/m,
    "the downgraded finding goes back too, with its lower severity and the verifier's reason, outside the findings that fail the verdict",
  );
  assert.doesNotMatch(sent, /helper's name|Taste/, "a rejected finding never reaches the agent");
  assert.doesNotMatch(sent, /nothing to fix/, "the must-fix finding is what there is to fix");

  await kit.idle(agentThreadId, "Looking at it."); // the doorbell for a sent-back verdict waits for the agent's fix turn to end
  await settled();
  assert.match(kit.doorbellsSent(threadId).at(-1) ?? "", /handed off: done, failed verification, a must-fix review finding upheld, findings sent back to it \(fix round 1\)$/m, "the doorbell names the cause");
  const update = await catchUp();
  assert.match(update, /handed off: done, failed verification, a must-fix review finding upheld, findings sent back to it\n/);
  assert.match(update, /Failed verification: a must-fix review finding upheld\. 2 of 2 criteria passed/);
  assert.match(update, /the verifier anchored 1, downgraded 1, confirmed 0 and rejected 1\. The ones that held went back to the agent with the failed verdict\./);
  assert.match(update, /\n- `src\/retry\.ts:42` \(must-fix\): The backoff never caps[^\n]*\n {2}Anchored, as it breaks the issue's brief: It never caps: 20 failures wait 17 minutes\.\n- `src\/retry\.ts` \(nit\): The retry helper's name says nothing about backoff\.\n {2}Rejected: Taste\./);

  const { round, body } = await opened();
  assert.deepEqual(judged(round), { outcome: { kind: "fail", by: "must-fix" }, results: ["pass", "pass"], fixRound: { round: 1, delivery: "sent" } }, "its round names the anchored must-fix finding as what failed it");
  assert.deepEqual(body.verdict, shownPassing(stored, { kind: "sent-back", ci: { kind: "none" } }), "the verdict whole, never its model, its triage, the rule's flag or the fix round");
});

test("a verdict that fails on a must-fix finding while CI is still to come says CI hadn't finished when the verdict failed, never that its criteria failed", async () => {
  const { check, handOff, reported, returned, catchUp } = await withAgent();
  await handOff({ ...DONE, prUrl: "https://github.com/acme/webhooks/pull/7" });
  await reported([FINDINGS[0]]);
  await returned({ ...PASSES, triage: [{ finding: 1, result: "anchored", anchor: "safety", reason: "It never caps." }] });
  await settled();

  const stored = check().verdict;
  assert.deepEqual(stored.state === "returned" && stored.settlement, { kind: "sent-back", round: 1, ci: { kind: "not-checked", reason: "CI hadn't finished when the verdict failed" } });
  assert.match(await catchUp(), /Failed verification: a must-fix review finding upheld\. 2 of 2 criteria passed[^\n]*CI: not checked \(CI hadn't finished when the verdict failed\)\./);
});

test("confirmed should-fix and nit findings, a downgraded must-fix and a rejected one leave a verdict that passes every criterion passed, and nothing goes back to the agent", async () => {
  const { kit, coordinatorId, agentThreadId, row, check, handOff, reported, returned, catchUp, opened } = await withAgent();
  await handOff();
  await reported([...FINDINGS, { file: "src/retry.ts", line: 7, severity: "should-fix", claim: "The jitter is computed twice." }, { file: "src/retry.ts", line: 3, severity: "must-fix", claim: "The import order breaks REVIEW.md." }]);
  const sentBefore = kit.delivered(agentThreadId).length;
  await returned({
    ...PASSES,
    triage: [
      { finding: 1, result: "rejected", reason: "retry.ts:44 caps it at 5 minutes." },
      { finding: 2, result: "confirmed", reason: "The name says retry, not backoff." },
      { finding: 3, result: "confirmed", reason: "Both calls sit on line 7." },
      { finding: 4, result: "downgraded", to: "nit", reason: "Neither the brief nor a criterion names REVIEW.md's import order." },
    ],
  });
  await settled();

  const stored = check().verdict;
  assert.deepEqual(stored.state === "returned" && stored.settlement, { kind: "checked", refused: null, ci: { kind: "none" } });
  assert.deepEqual(await row(), ["in-review", "✓ Verified: Retries land with backoff"]);
  assert.equal(kit.delivered(agentThreadId).length, sentBefore, "nothing went back to the agent");
  const update = await catchUp();
  assert.match(update, /Verified: 2 of 2 criteria passed/);
  assert.match(update, /the verifier anchored 0, downgraded 1, confirmed 2 and rejected 1\. None of them went to the agent\./);
  assert.match(update, /\n- `src\/retry\.ts` \(nit\)[^\n]*\n {2}Confirmed: The name says retry, not backoff\.\n- `src\/retry\.ts:7` \(should-fix\)[^\n]*\n {2}Confirmed: Both calls sit on line 7\.\n- `src\/retry\.ts:3` \(must-fix\)[^\n]*\n {2}Downgraded to nit: Neither the brief/);
  assert.doesNotMatch(update, /must-fix review finding upheld/);

  const { round, body } = await opened();
  assert.deepEqual(round.verdict?.outcome, { kind: "pass" }, "no finding fails its round");
  assert.deepEqual(body.verdict, shownPassing(stored, { kind: "checked", ci: { kind: "none" } }), "the verdict whole, never its model, its triage or the rule's flag");
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
  assert.deepEqual(review(), { state: "missed", at: kit.clock.now, reviewerThreadId, reason });
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
  assert.deepEqual(silent.review(), { state: "missed", at: silent.kit.clock.now, reviewerThreadId: silent.kit.store.issueThreads(silent.coordinatorId, silent.check().issueId).at(-2)?.threadId ?? assert.fail(), reason: "its reviewer ended its turn without reporting" });
  assert.match(silent.kit.thread(silent.verifier()).spawnedWith.prompt ?? "", /No review was had: its reviewer ended its turn without reporting\./);

  const refused = await withAgent();
  let refusals = 1;
  // why one refusal: bb refuses the reviewer's spawn and takes the verifier's after it.
  Object.defineProperty(refused.kit.spawns, "answer", { get: () => (refusals-- > 0 ? "refused" : "thread") });
  await refused.handOff();
  assert.deepEqual(refused.review(), { state: "missed", at: refused.kit.clock.now, reviewerThreadId: null, reason: "bb did not start a reviewer: HTTP 400: Invalid environment" });
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
  assert.deepEqual(refused.review(), { state: "missed", at: refused.kit.clock.now, reviewerThreadId: stuck, reason: 'its reviewer asked a person "Reconnect GitHub on ChatGPT", and bb refused the plugin\'s decline: bb is restarting' });
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

  // As the release before reviews left it: no review column, no triage or time on a verdict, none of the
  // issue feed's tables, and every migration from the review column on still to run.
  for (const { name } of z.array(z.object({ name: z.string() })).parse(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%issue_writes%'").all())) db.exec(`DROP TRIGGER ${name}`);
  db.exec("DROP TABLE issue_writes");
  db.exec("DROP TABLE issue_log");
  db.exec("DROP TABLE comments");
  db.exec("DROP INDEX events_of_issue");
  db.exec("ALTER TABLE decisions DROP COLUMN cap");
  db.exec("ALTER TABLE events DROP COLUMN doorbell");
  db.exec("ALTER TABLE checks DROP COLUMN review");
  db.exec("UPDATE checks SET verdict = json_remove(verdict, '$.triage', '$.at')");
  migrated.applied = MIGRATIONS.findIndex((statement) => statement.includes("ADD COLUMN review"));
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

test("a check stores each finding's severity once, on its review; a verdict settled before a must-fix finding could fail one keeps its outcome, and one still to settle settles by the rule", async () => {
  const { db, storage, migrated } = rollbackableStorage();
  const settledBefore = await withAgent({ storage });
  await settledBefore.handOff();
  await settledBefore.reported(FINDINGS);
  await settledBefore.returned({ ...PASSES, triage: [{ finding: 1, result: "rejected", reason: "It caps at 5 minutes." }, { finding: 2, result: "confirmed", reason: "A fair point." }] });
  await settled();
  const row = () => z.object({ verdict: z.string() }).parse(db.prepare("SELECT verdict FROM checks").get()).verdict;
  assert.deepEqual(z.object({ triage: z.unknown() }).parse(JSON.parse(row())).triage, [
    { result: "rejected", reason: "It caps at 5 minutes." },
    { result: "confirmed", reason: "A fair point." },
  ], "the verdict stores only the verifier's triage");

  // As the release before this rule left a verdict that passed with the must-fix finding confirmed: settled, and its last migration still to run.
  db.exec(`UPDATE checks SET verdict = json_remove(json_set(verdict, '$.triage[0].result', 'confirmed'), '$.mustFixFails')`);
  // why the issue log, comments, the decisions' cap and the events' doorbell dropped too: they came after this rule, and their migrations run again.
  db.exec("DROP TABLE issue_log");
  db.exec("DROP TABLE comments");
  db.exec("ALTER TABLE decisions DROP COLUMN cap");
  db.exec("ALTER TABLE events DROP COLUMN doorbell");
  migrated.applied = BEFORE_MUST_FIX;
  settledBefore.kit.reload();
  const kept = settledBefore.check().verdict;
  assert.deepEqual(kept.state === "returned" && [kept.mustFixFails, kept.triage.map(({ severity, result }) => [severity, result])], [false, [["must-fix", "confirmed"], ["nit", "confirmed"]]]);
  assert.deepEqual(await settledBefore.row(), ["in-review", "✓ Verified: Retries land with backoff"], "it keeps the outcome it was settled and announced with");
  const keptRound = await settledBefore.opened();
  assert.deepEqual(judged(keptRound.round), { outcome: { kind: "pass" }, results: ["pass", "pass"], fixRound: null }, "its round still reads passed");
  assert.deepEqual(keptRound.body.verdict, shownPassing(kept, { kind: "checked", ci: { kind: "none" } }));
  const update = await settledBefore.catchUp();
  assert.match(update, /Verified: 2 of 2 criteria passed/);
  assert.match(update, /\n- `src\/retry\.ts:42` \(must-fix\)[^\n]*\n {2}Confirmed: It caps at 5 minutes\./, "the confirmed must-fix finding is listed as confirmed");
  assert.doesNotMatch(update, /must-fix review finding upheld/, "never as failing a verdict it didn't fail");

  // One still to settle settles by the rule: failed, its finding sent back as the fix round, and the manager told.
  const settles = await releasedWith("waiting-for-ci");
  const sentBefore = settles.kit.delivered(settles.agentThreadId).length;
  await settles.kit.tick();
  await settled();
  const sentBack = settles.check().verdict;
  assert.deepEqual(sentBack.state === "returned" && [sentBack.mustFixFails, sentBack.settlement], [true, { kind: "sent-back", round: 1, ci: { kind: "not-checked", reason: "CI hadn't finished when the verdict failed" } }]);
  assert.equal(settles.kit.delivered(settles.agentThreadId).length, sentBefore + 1);
  assert.match(settles.kit.delivered(settles.agentThreadId).at(-1) ?? "", /^## Verifier findings: a must-fix review finding upheld[\s\S]*The verifier: Confirmed\. It never caps\./);
  assert.match(await settles.catchUp(), /Failed verification: a must-fix review finding upheld\. 2 of 2 criteria passed/);

  // One whose must-fix finding was rejected waits for CI again, and nothing goes back.
  const stillWaits = await releasedWith("waiting-for-ci", "rejected");
  const before = stillWaits.kit.delivered(stillWaits.agentThreadId).length;
  await stillWaits.kit.tick();
  await settled();
  const waitsAgain = stillWaits.check().verdict;
  assert.deepEqual(waitsAgain.state === "returned" && [waitsAgain.mustFixFails, waitsAgain.settlement], [true, { kind: "waiting-for-ci" }]);
  assert.equal(stillWaits.kit.delivered(stillWaits.agentThreadId).length, before);

  // One left pending, as when the plugin stopped before settling it, settles by the rule too.
  const stopped = await releasedWith("pending");
  await stopped.kit.tick();
  await settled();
  const pendingSettles = stopped.check().verdict;
  assert.deepEqual(pendingSettles.state === "returned" && [pendingSettles.mustFixFails, pendingSettles.settlement.kind], [true, "sent-back"]);
  assert.match(stopped.kit.delivered(stopped.agentThreadId).at(-1) ?? "", /^## Verifier findings: a must-fix review finding upheld[\s\S]*The verifier: Confirmed\. It never caps\./);

  // A handover before the plugin's first tick leaves it to settle as failed, never superseded unjudged.
  const replaced = await releasedWith("waiting-for-ci");
  const old = replaced.check().id;
  assert.match(textOf(await replaced.kit.call("agent_start", { issue: "WEB-1" }, replaced.threadId)), /a2/);
  await replaced.kit.tick();
  await settled();
  const checked = replaced.kit.store.check(old)?.verdict;
  assert.deepEqual(checked?.state === "returned" && checked.settlement.kind, "checked", "its agent was replaced, so it is the manager's");
  assert.match(await replaced.catchUp(), /Failed verification: a must-fix review finding upheld\. 2 of 2 criteria passed/);

  // One that still passes, handed over before the first tick, is superseded as it would have been while it waited: nobody is told, even once CI passes.
  const moot = await releasedWith("waiting-for-ci", "rejected");
  const mootCheck = moot.check().id;
  const toldBefore = await moot.catchUp();
  assert.match(textOf(await moot.kit.call("agent_start", { issue: "WEB-1" }, moot.threadId)), /a2/);
  await moot.kit.tick();
  await settled();
  const branch = moot.kit.thread(moot.agentThreadId).environmentBranchName ?? assert.fail("no branch");
  moot.kit.github.prs.set(branch, { number: 7, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: "SUCCESS", failed: [] });
  await moot.kit.tick();
  await settled();
  const superseded = moot.kit.store.check(mootCheck)?.verdict;
  assert.deepEqual(superseded?.state === "returned" && superseded.settlement, { kind: "superseded" });
  assert.doesNotMatch(await moot.catchUp(), /\(a1\) handed off: done/, "nothing about the replaced agent's handoff");
  assert.doesNotMatch(toldBefore, /\(a1\) handed off: done/);
});

/** The last migration statement the release before this rule ran: the next makes a confirmed must-fix finding fail a verdict. */
const BEFORE_MUST_FIX = MIGRATIONS.findIndex((statement) => statement.includes("'$.mustFixFails'"));

/**
 * An agent whose done handoff, as the release before this rule left it, passed every criterion with its must-fix finding
 * `triaged` (by default confirmed), and was `left`: waiting for CI still to finish on its pull
 * request, or pending, its settlement's write failed as when the plugin stops before settling it;
 * then the plugin upgrades.
 */
async function releasedWith(left: "waiting-for-ci" | "pending", triaged: "confirmed" | "rejected" = "confirmed") {
  const before = rollbackableStorage();
  const agent = await withAgent({ storage: before.storage });
  const branch = agent.kit.thread(agent.agentThreadId).environmentBranchName ?? assert.fail("no branch");
  agent.kit.github.prs.set(branch, { number: 7, state: "OPEN", isDraft: false, reviewDecision: null, head: HEAD, rollup: left === "pending" ? "SUCCESS" : "PENDING", failed: [] });
  await agent.handOff({ ...DONE, prUrl: "https://github.com/acme/webhooks/pull/7" });
  await agent.kit.tick();
  await agent.reported([FINDINGS[0]]);
  const restore = left === "pending" ? failWrites(before.db, "INSERT", "events") : () => {};
  const verifierThreadId = agent.verifier();
  await agent.kit.call("issue_verdict", { ...PASSES, triage: [{ finding: 1, result: "rejected", reason: "It caps." }] }, verifierThreadId);
  await settled();
  restore();
  const stored = agent.check().verdict;
  assert.equal(stored.state === "returned" && stored.settlement.kind, left, "as the release before this rule left it");
  // The release before this rule let a confirmed must-fix finding pass, and stored no mustFixFails.
  before.db.prepare("UPDATE checks SET verdict = json_remove(json_set(verdict, '$.triage[0]', json(?)), '$.mustFixFails')").run(JSON.stringify({ result: triaged, reason: "It never caps." }));
  // why the issue log, comments, the decisions' cap and the events' doorbell dropped too: they came after this rule, and their migrations run again.
  before.db.exec("DROP TABLE issue_log");
  before.db.exec("DROP TABLE comments");
  before.db.exec("ALTER TABLE decisions DROP COLUMN cap");
  before.db.exec("ALTER TABLE events DROP COLUMN doorbell");
  before.migrated.applied = BEFORE_MUST_FIX;
  agent.kit.reload();
  return agent;
}

test("a verdict that fails only on anchored must-fix findings after the agent's fix round waits under Needs you, its headline and doorbell naming them", async () => {
  const { kit, threadId, agentThreadId, row, handOff, reported, returned } = await withAgent();
  await handOff();
  await reported([]);
  await returned(FAILS);
  await settled();
  const sentBefore = kit.delivered(agentThreadId).length;

  await handOff();
  await reported([FINDINGS[0], { file: "src/retry.ts", line: 9, severity: "must-fix", claim: "A 4xx is retried." }]);
  await returned({ ...PASSES, triage: [{ finding: 1, result: "anchored", anchor: "criterion", reason: "It never caps." }, { finding: 2, result: "anchored", anchor: "regression", reason: "A 404 is retried 5 times." }] });
  await settled();

  assert.equal(kit.delivered(agentThreadId).length, sentBefore, "its one fix round is spent: nothing more goes back");
  assert.deepEqual(await row(), ["needs-you", "✗ 2 must-fix review findings upheld after its fix round: Retries land with backoff"]);
  assert.match(kit.doorbellsSent(threadId).at(-1) ?? "", /- WEB-1 "Add retries" \(a1\) handed off: done, failed verification, 2 must-fix review findings upheld$/);
});

const ROUND_2 = "fedcba9876543210fedcba9876543210fedcba98";
const JITTER = { file: "src/retry.ts", line: 7, severity: "should-fix", claim: "The jitter is computed twice." };

/** WEB-1 after round 1 failed on its anchored must-fix, its jitter confirmed beside it, and its agent's second done handoff at ROUND_2, whose reviewer now runs. */
async function secondRound() {
  const agent = await withAgent();
  const { kit, agentThreadId, handOff, reported, returned } = agent;
  await handOff();
  await reported([FINDINGS[0], JITTER]);
  await returned({ ...PASSES, triage: [{ finding: 1, result: "anchored", anchor: "brief", reason: "It never caps." }, { finding: 2, result: "confirmed", reason: "Both calls on line 7." }] });
  await settled();
  kit.git.heads.set(kit.thread(agentThreadId).environmentId ?? assert.fail("no environment"), ROUND_2);
  await handOff({ ...DONE, headSha: ROUND_2 });
  return agent;
}

test("a later round's reviewer is told to review git diff from the last reviewed commit to the new one, limited to the branch's files, with that round's blocking findings numbered and the known ones listed; a first round's asks for the whole diff", async () => {
  const { kit, reviewer } = await secondRound();
  const prompt = kit.thread(reviewer()).spawnedWith.prompt ?? assert.fail("no prompt");
  const part = (heading: string) => prompt.split("\n\n## ").find((one) => one.startsWith(heading)) ?? assert.fail(`no ${heading}`);
  assert.equal(
    part("The diff"),
    `The diff\n\nRound 1 was the last round reviewed, at \`${HEAD}\`. Review only what changed since then, up to \`${ROUND_2}\`, checked out in this environment: \`git diff ${HEAD} ${ROUND_2}\`, limited to the files this branch changes (\`git diff origin/main...${ROUND_2} --stat\`), so commits merged in from the default branch are not reviewed.\n\nIf \`git cat-file -e ${HEAD}\` fails, that commit isn't in this environment: review the whole diff instead (\`git diff origin/main...${ROUND_2}\`), mark every finding new, and still answer each of round 1's blocking findings below.`,
  );
  assert.equal(
    part("Round 1's blocking findings"),
    "Round 1's blocking findings\n\nEach of these failed round 1's verdict. Answer every one in issue_review's earlier, by its number: fixed or not, with a note on what you saw. One not fixed goes to the verifier again, as unfixed; don't report it again as a finding.\n\n1. `src/retry.ts:42` (must-fix): The backoff never caps, so a dead endpoint is retried every 2^n ms forever.",
  );
  assert.equal(part("Findings already known"), "Findings already known\n\nEarlier rounds' findings that held. Don't report them again.\n\n- `src/retry.ts:7` (should-fix): The jitter is computed twice.");
  assert.match(part("Marking your findings"), /^Marking your findings\n\nMark each finding you report with its origin: new, on code changed since round 1's commit, or missed, on code round 1 reviewed unchanged\. A finding marked missed sits on code an earlier round reviewed unchanged: it never fails the verdict, whatever it breaks, safety included/);

  const first = await withAgent();
  await first.handOff();
  const opening = first.kit.thread(first.reviewer()).spawnedWith.prompt ?? assert.fail("no prompt");
  assert.match(opening, new RegExp(`## The diff\\n\\nThe commits up to \`${HEAD}\`, checked out in this environment, that \`origin/main\` doesn't have \\(\`git diff origin/main\\.\\.\\.${HEAD}\`\\)\\.\\n\\n## The issue's brief`), "the whole diff, as before");
  assert.doesNotMatch(opening, /blocking findings|already known|Marking your findings/);
});

test("issue_review refuses an earlier that misses one of the earlier round's blocking findings, and missed on a first review; it stores an earlier finding answered not fixed as an unfixed finding, with its answers", async () => {
  const { kit, review, reviewer } = await secondRound();
  const MISSED_FINDING = { file: "src/retry.ts", line: 2, severity: "must-fix", claim: "The import order breaks REVIEW.md.", origin: "missed" } as const;
  const unanswered = await kit.call("issue_review", { findings: [MISSED_FINDING], earlier: [] }, reviewer());
  assert.ok(isRefusal(unanswered));
  assert.equal(textOf(unanswered), "issue_review is refused and nothing was saved: answer every earlier blocking finding; missing 1 of 1 to 1.");
  const invented = await kit.call("issue_review", { findings: [], earlier: [1, 2].map((finding) => ({ finding, fixed: true, note: "Capped." })) }, reviewer());
  assert.equal(textOf(invented), "issue_review is refused and nothing was saved: there is only 1 earlier blocking finding; 2 is not one.");
  assert.equal(review().state, "running", "nothing was saved");

  const answer = { finding: 1, fixed: false, note: "retry.ts:42 still doubles with no ceiling." };
  const threadId = reviewer();
  assert.equal(textOf(await kit.call("issue_review", { findings: [MISSED_FINDING], earlier: [answer] }, threadId)), "Review recorded: 1 finding, and 1 earlier blocking finding not fixed. A verifier triages them next. Stop here; don't change anything in this environment.");
  const stored = review();
  assert.deepEqual(stored.state === "reported" && [stored.findings, stored.earlier], [
    [{ ...FINDINGS[0], origin: "unfixed" }, MISSED_FINDING],
    [{ fixed: false, note: answer.note }],
  ], "the earlier must-fix, unfixed, first, then the reviewer's own; and its answer");

  const first = await withAgent();
  await first.handOff();
  const missed = await first.kit.call("issue_review", { findings: [{ ...FINDINGS[0], origin: "missed" }] }, first.reviewer());
  assert.ok(isRefusal(missed));
  assert.equal(textOf(missed), "issue_review is refused and nothing was saved: this is the issue's first reviewed round, so no earlier round reviewed any of this code: mark every finding new.");
  const early = await first.kit.call("issue_review", { findings: [], earlier: [{ finding: 1, fixed: true, note: "Fine." }] }, first.reviewer());
  assert.equal(textOf(early), "issue_review is refused and nothing was saved: there are no earlier blocking findings to answer; pass [].");
  assert.equal(first.review().state, "running");
});
