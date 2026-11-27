import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema, type Agent, type AgentId } from "../agent/agent.ts";
import { handoffIdSchema, type Handoff } from "../agent/handoff.ts";
import { decisionIdSchema, type IssueDecision } from "../decision.ts";
import type { InboxEvent, StoredEvent } from "../inbox/inbox-event.ts";
import { issueIdSchema } from "../issue/issue.ts";
import type { Handed, IssueStatus } from "../issue/status.ts";
import { coordinatorIdSchema } from "../role.ts";
import { checkIdSchema, type Check, type FinalCheck } from "../verdict/check.ts";
import type { PrSnapshot } from "../verdict/pr.ts";
import type { Review, Triaged } from "../verdict/review.ts";
import type { CriterionResult, Verdict } from "../verdict/verdict.ts";
import { shownIn, timeOf, type Entry, type Filter } from "./entry.ts";
import { commentIdSchema, type Comment } from "./comment.ts";
import { feedOf } from "./feed.ts";

/** What feedOf is made of. */
type FeedFacts = Parameters<typeof feedOf>[0];
import type { Logged } from "./log-event.ts";
import { criteriaGrid, roundOf, scoreOf, type Round, type Step } from "./round.ts";

const MANAGER = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
const BBP_19 = issueIdSchema.parse("BBP-19");
const [A1, A2] = [agentIdSchema.parse("a1"), agentIdSchema.parse("a2")];
const CRITERIA = ["npm run check passes", "the card shows the row's facts when its read fails", "Escape closes the card"];
const SHA = "a".repeat(40);

/** A uuid whose last digits are `n`, so a fixture's ids read in order. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function handoff(n: number, agentId: AgentId, at: number, status: Handoff["status"] = "done"): Handoff {
  const made = { id: handoffIdSchema.parse(uuid(n)), coordinatorId: MANAGER, issueId: BBP_19, agentId, at, turnSeq: n, summary: `Round ${n}`, did: [], evidence: [], concerns: [], deviations: [], findings: [], attachments: [] };
  return status === "done" ? { ...made, status, delivery: { kind: "commit", headSha: SHA, prUrl: null } } : { ...made, status };
}

function returned(results: readonly CriterionResult[], at: number, settlement: Extract<Verdict, { state: "returned" }>["settlement"], triage: Triaged[] = []): Verdict {
  return {
    state: "returned",
    attachments: [],
    at,
    verifierThreadId: "thr_verifier",
    headSha: SHA,
    checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
    criteria: results.map((result, i) => ({ criterion: CRITERIA[i] ?? "", result, shows: "Ran it.", evidence: `evidence ${i + 1}` })),
    findings: [],
    blocking: [],
    triage,
    mustFixFails: true,
    model: { providerId: "claude-code", model: "sonnet" },
    sameModel: false,
    settlement,
  };
}

function handed(made: Handoff, verdict: Verdict | null, review: Review = { state: "none" }): Handed {
  if (verdict === null) return { handoff: made, check: null };
  const check: Check = { id: checkIdSchema.parse(uuid(100 + Number(made.turnSeq))), coordinatorId: MANAGER, issueId: BBP_19, at: made.at, criteria: CRITERIA, verifier: null, subject: { kind: "handoff", agentId: made.agentId, handoffId: made.id, headSha: SHA, prUrl: null, branch: null }, review, verdict, followUpId: null, acceptedAt: null };
  return { handoff: made, check };
}

const checkIdOf = ({ check }: Handed) => check?.id ?? assert.fail("no check");
const stored = (events: [number, InboxEvent][]): StoredEvent[] => events.map(([at, event], i) => ({ id: i + 1, at, event }));
const pr = (state: PrSnapshot["state"], ci: PrSnapshot["ci"]): PrSnapshot => ({ forge: "github", number: 219, url: "https://github.com/ivan-anchev/bb-plugins/pull/219", state, draft: false, review: "none", ci, headSha: SHA, failedChecks: [] });
const agent = (id: AgentId, startedAt: number, ended: Agent["ended"]): FeedFacts["agents"][number] => ({ id, startedAt, ended });

/** BBP-19 as it went: a1 failed twice, the manager handed it to a2, which failed once and then passed; #219 opened, passed CI and merged. */
function bbp19(): FeedFacts {
  const one = handed(handoff(1, A1, 3_000), returned(["pass", "fail", "fail"], 3_500, { kind: "sent-back", round: 1, ci: { kind: "none" } }, [
    { title: "The spinner stays", file: "src/card.tsx", line: 4, severity: "must-fix", claim: "The spinner stays.", origin: "new", result: "anchored", anchor: "criterion", steps: null, reason: "Seen." },
    { title: "Padding", file: "src/card.css", line: null, severity: "nit", claim: "Padding.", origin: "new", result: "rejected", reason: "Matches the row." },
  ]), {
    state: "reported",
    at: 3_200,
    reviewerThreadId: "thr_reviewer",
    findings: [
      { title: "The spinner stays", file: "src/card.tsx", line: 4, severity: "must-fix", claim: "The spinner stays.", origin: "new" },
      { title: "Padding", file: "src/card.css", line: null, severity: "nit", claim: "Padding.", origin: "new" },
    ],
    earlier: [],
    model: { providerId: "codex", model: "gpt-5.4" },
  });
  const two = handed(handoff(2, A1, 4_000), returned(["pass", "pass", "fail"], 4_500, { kind: "checked", refused: null, ci: { kind: "none" } }));
  const three = handed(handoff(3, A2, 5_000), returned(["pass", "pass", "fail"], 5_500, { kind: "sent-back", round: 1, ci: { kind: "none" } }));
  const four = handed(handoff(4, A2, 5_800), returned(["pass", "pass", "pass"], 6_400, { kind: "checked", refused: null, ci: { kind: "pass", forge: "github", number: 219 } }));
  const decisions: IssueDecision[] = [
    { kind: "asked", id: decisionIdSchema.parse("d1"), question: "Keep the row's facts?", options: ["Keep", "Hide"], recommended: null, at: 3_700, answer: { text: "Keep", at: 3_800 }, cap: null },
    { kind: "recorded", text: "a1 loops: hand BBP-19 to a fresh agent.", at: 4_700 },
    { kind: "recorded", text: "Verified and merged.", at: 6_700 },
  ];
  return {
    issue: { createdAt: 1_000 },
    agents: [agent(A1, 2_000, { how: "replaced", at: 4_800, left: null }), agent(A2, 4_800, null)],
    handed: [one, two, three, four],
    finalChecks: [],
    decisions,
    events: stored([
      [3_600, { kind: "sent-back", issueId: BBP_19, agentId: A1, checkId: checkIdOf(one), round: 1 }],
      [3_900, { kind: "decision-answered", decisionId: decisionIdSchema.parse("d1") }],
      [4_600, { kind: "checked", issueId: BBP_19, checkId: checkIdOf(two), asked: null }],
      [5_200, { kind: "pr", issueId: BBP_19, agentId: A2, pr: pr("open", "pending"), changes: ["opened"] }],
      [5_600, { kind: "sent-back", issueId: BBP_19, agentId: A2, checkId: checkIdOf(three), round: 1 }],
      [6_000, { kind: "pr", issueId: BBP_19, agentId: A2, pr: pr("open", "pass"), changes: ["ci-passed"] }],
      [6_500, { kind: "checked", issueId: BBP_19, checkId: checkIdOf(four), asked: null }],
      [6_600, { kind: "pr", issueId: BBP_19, agentId: A2, pr: pr("merged", "pass"), changes: ["merged"] }],
      [6_650, { kind: "checked", issueId: BBP_19, checkId: checkIdOf(four), asked: null }],
    ]),
    log: [],
    comments: [],
    followUps: [],
    followUpOf: null,
  };
}

const roundsIn = (entries: readonly Entry[]): Round[] => entries.flatMap((entry) => (entry.kind === "round" ? [entry.round] : []));

test("BBP-19's feed: every moment in the order it happened, each round numbered, scored and timed by the event that announced its outcome", () => {
  const entries = feedOf(bbp19());
  assert.deepEqual(
    entries.map((entry) => [entry.kind, timeOf(entry)]),
    [
      ["created", 1_000],
      ["agent-started", 2_000],
      ["round", 3_000],
      ["decision", 3_700],
      ["round", 4_000],
      ["decision", 4_700],
      ["agent-ended", 4_800],
      ["agent-started", 4_800],
      ["round", 5_000],
      ["pr", 5_200],
      ["round", 5_800],
      ["pr", 6_000],
      ["pr", 6_600],
      ["decision", 6_700],
    ],
  );
  assert.deepEqual(
    roundsIn(entries).map((round) => ({ number: round.number, by: round.by.kind === "agent" && round.by.agentId, score: scoreOf(round), outcomeAt: round.outcome?.at ?? null, fixRound: round.verdict?.fixRound })),
    [
      { number: 1, by: "a1", score: { kind: "failed", by: "criteria", passed: 1, of: 3 }, outcomeAt: 3_600, fixRound: { round: 1, delivery: "sent" } },
      { number: 2, by: "a1", score: { kind: "failed", by: "criteria", passed: 2, of: 3 }, outcomeAt: 4_600, fixRound: null },
      { number: 3, by: "a2", score: { kind: "failed", by: "criteria", passed: 2, of: 3 }, outcomeAt: 5_600, fixRound: { round: 1, delivery: "sent" } },
      { number: 4, by: "a2", score: { kind: "judged", passed: 3, of: 3 }, outcomeAt: 6_500, fixRound: null },
    ],
    "the first event naming a check times its outcome; a later one doesn't move it",
  );
  const [first] = roundsIn(entries);
  assert.deepEqual(first?.review, { state: "reported", step: { at: 3_200, moved: null }, findings: 2, held: 1, downgraded: 0 });
  assert.deepEqual(
    entries.flatMap((entry) => (entry.kind === "pr" ? [entry.changes] : [])),
    [["opened"], ["ci-passed"], ["merged"]],
  );
});

test("a round in flight says so and scores by its stage; a blocked handoff's round has no verdict and no score", () => {
  const reviewing = handed(handoff(1, A1, 3_000), { state: "queued", checkout: null }, { state: "queued" });
  const verifying = handed(handoff(2, A1, 4_000), { state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: null }, { state: "missed", at: 4_100, reviewerThreadId: null, reason: "no reviewer model" });
  const blocked = handed(handoff(3, A1, 5_000, "blocked"), null);
  const rounds = roundsIn(feedOf({ ...bbp19(), handed: [reviewing, verifying, blocked], events: [] }));
  assert.deepEqual(
    rounds.map((round) => [round.inFlight, scoreOf(round), round.review, round.outcome]),
    [
      [true, { kind: "pending", stage: "reviewing" }, { state: "pending" }, null],
      [true, { kind: "pending", stage: "verifying" }, { state: "missed", step: { at: 4_100, moved: null } }, null],
      [false, null, { state: "none" }, null],
    ],
  );
});

test("a build parent's final checks are rounds among its handoffs, numbered by when they began", () => {
  const final = (n: number, at: number): FinalCheck => ({ id: checkIdSchema.parse(uuid(n)), coordinatorId: MANAGER, issueId: BBP_19, at, criteria: CRITERIA, verifier: null, subject: { kind: "final", defaultBranch: "main", merged: [] }, review: { state: "none" }, verdict: { state: "waived" }, followUpId: null, acceptedAt: null });
  const rounds = roundsIn(feedOf({ ...bbp19(), handed: [handed(handoff(1, A1, 3_000), null)], finalChecks: [final(7, 2_500), final(8, 4_000)], events: [] }));
  assert.deepEqual(
    rounds.map(({ number, key, by }) => [number, key.slice(0, 2), by.kind]),
    [
      [1, "f-", "final"],
      [2, "h-", "agent"],
      [3, "f-", "final"],
    ],
  );
  assert.deepEqual(scoreOf(rounds[0] ?? assert.fail()), { kind: "unjudged", outcome: "unverified" });
});

test("the criteria grid has a row per criterion and a cell per round with a verdict, by position", () => {
  const rounds = roundsIn(feedOf(bbp19()));
  const grid = criteriaGrid([...CRITERIA, "A criterion added after round 4"], rounds);
  assert.deepEqual(
    grid.map(({ criterion, cells }) => [criterion, cells.map(({ result }) => result)]),
    [
      [CRITERIA[0], ["pass", "pass", "pass", "pass"]],
      [CRITERIA[1], ["fail", "pass", "pass", "pass"]],
      [CRITERIA[2], ["fail", "fail", "fail", "pass"]],
      ["A criterion added after round 4", [null, null, null, null]],
    ],
  );
});

test("the filters: All shows everything, Rounds only rounds, Discussion only decisions and questions", () => {
  const entries = feedOf(bbp19());
  const kinds = (filter: "all" | "rounds" | "discussion") => [...new Set(entries.filter((entry) => shownIn(filter, entry)).map(({ kind }) => kind))];
  assert.deepEqual(kinds("all"), ["created", "agent-started", "round", "decision", "agent-ended", "pr"]);
  assert.deepEqual(kinds("rounds"), ["round"]);
  assert.deepEqual(kinds("discussion"), ["decision"]);
});

test("a round whose criteria all passed scores a pass only once it is settled: before, it is verifying or waiting for CI, and one replaced says so; a failed criterion fails it whatever comes", () => {
  const scored = (verdict: Verdict) => scoreOf(roundOf(handed(handoff(1, A1, 3_000), verdict), 1, null, null));
  const passed = (settlement: Extract<Verdict, { state: "returned" }>["settlement"]) => scored(returned(["pass", "pass", "pass"], 3_500, settlement));
  assert.deepEqual(passed({ kind: "pending" }), { kind: "pending", stage: "verifying" });
  assert.deepEqual(passed({ kind: "waiting-for-ci" }), { kind: "pending", stage: "ci" });
  assert.deepEqual(passed({ kind: "superseded" }), { kind: "unjudged", outcome: "superseded" });
  assert.deepEqual(passed({ kind: "checked", refused: null, ci: { kind: "pass", forge: "github", number: 7 } }), { kind: "judged", passed: 3, of: 3 });
  assert.deepEqual(passed({ kind: "checked", refused: null, ci: { kind: "fail", forge: "github", number: 7, failedChecks: ["test"] } }), { kind: "failed", by: "ci" }, "every criterion passed: it leads with why it failed");
  const clean = returned(["pass", "pass", "pass"], 3_500, { kind: "checked", refused: null, ci: { kind: "none" } });
  const dirty: Verdict = clean.state === "returned" ? { ...clean, checkout: { headSha: SHA, changedFiles: ["?? notes.md"], changedFileCount: 1 } } : assert.fail("not returned");
  assert.deepEqual(scored(dirty), { kind: "failed", by: "checkout" });
  assert.deepEqual(scored(returned(["pass", "fail", "pass"], 3_500, { kind: "pending" })), { kind: "failed", by: "criteria", passed: 2, of: 3 });
});

test("a fix round says whether its findings reached the agent: sent, or maybe, when the plugin can't tell; none while they are on their way, as the round is in flight", () => {
  const fixRound = (settlement: Extract<Verdict, { state: "returned" }>["settlement"]) => roundOf(handed(handoff(1, A1, 3_000), returned(["fail", "pass", "pass"], 3_500, settlement)), 1, null, null).verdict?.fixRound;
  assert.deepEqual(
    [fixRound({ kind: "sending-back", round: 1, ci: { kind: "none" } }), fixRound({ kind: "sent-back", round: 1, ci: { kind: "none" } }), fixRound({ kind: "maybe-sent-back", round: 2, ci: { kind: "none" } }), fixRound({ kind: "checked", refused: null, ci: { kind: "none" } })],
    [null, { round: 1, delivery: "sent" }, { round: 2, delivery: "maybe" }, null],
  );
});

test("a check superseded while its review was to come is no longer in flight: its review reads as none and its score as replaced", () => {
  const superseded = roundOf(handed(handoff(1, A1, 3_000), { state: "superseded" }, { state: "running", reviewerThreadId: "thr_reviewer", scoped: true }), 1, null, null);
  assert.deepEqual([superseded.inFlight, superseded.review, scoreOf(superseded)], [false, { state: "none" }, { kind: "unjudged", outcome: "superseded" }]);
  const reviewing = roundOf(handed(handoff(2, A1, 4_000), { state: "queued", checkout: null }, { state: "running", reviewerThreadId: "thr_reviewer", scoped: true }), 2, null, null);
  assert.deepEqual([reviewing.inFlight, reviewing.review, scoreOf(reviewing)], [true, { state: "pending" }, { kind: "pending", stage: "reviewing" }]);
});

test("a verdict failed by its checkout and a criterion names its checkout first, in its round as in the issue's headline (verdict.ts failureReasons)", () => {
  const both = returned(["fail", "pass", "pass"], 3_500, { kind: "checked", refused: null, ci: { kind: "none" } });
  const dirty: Verdict = both.state === "returned" ? { ...both, checkout: { headSha: SHA, changedFiles: ["?? notes.md"], changedFileCount: 1 } } : assert.fail("not returned");
  const round = roundOf(handed(handoff(1, A1, 3_000), dirty), 1, null, null);
  assert.deepEqual([round.verdict?.outcome, scoreOf(round)], [{ kind: "fail", by: "checkout" }, { kind: "failed", by: "checkout" }]);
});

/** The issue's log: each status as the plugin observed it, at its time. */
const observed = (statuses: [number, IssueStatus][]): Logged[] => statuses.map(([at, status]) => ({ at, event: { kind: "status", status } }));

/** Every round step shown with the status it moved the issue to, as [step, its time, the status]. */
function glyphsOf(entries: readonly Entry[]): [string, number, IssueStatus][] {
  return entries.flatMap((entry): [string, number, IssueStatus][] => {
    if (entry.kind !== "round") return [];
    const { number, handed: began, review, verdict, outcome } = entry.round;
    const steps: [string, Step | null][] = [["handed", began], ["review", review.state === "missed" || review.state === "reported" ? review.step : null], ["verdict", verdict?.step ?? null], ["outcome", outcome]];
    return steps.flatMap(([name, step]): [string, number, IssueStatus][] => (step === null || step.moved === null ? [] : [[`round ${number} ${name}`, step.at, step.moved]]));
  });
}

/** The statuses no moment explains, each a line of its own, as [its time, the status]. */
const movesOf = (entries: readonly Entry[]): [number, IssueStatus][] => entries.flatMap((entry): [number, IssueStatus][] => (entry.kind === "moved" ? [[entry.at, entry.status]] : []));

test("each observed status belongs to the latest moment before it since the status before: a round's handed, review, verdict or outcome step shows it, any other moment says it in its words", () => {
  const entries = feedOf({
    ...bbp19(),
    log: observed([
      [1_001, "todo"],
      [2_001, "in-progress"],
      [3_010, "reviewing"],
      [3_210, "verifying"],
      [3_610, "in-progress"],
      [6_450, "in-review"],
      [6_610, "done"],
    ]),
  });
  assert.deepEqual(glyphsOf(entries), [
    ["round 1 handed", 3_000, "reviewing"],
    ["round 1 review", 3_200, "verifying"],
    ["round 1 outcome", 3_600, "in-progress"],
    ["round 4 verdict", 6_400, "in-review"],
  ]);
  assert.deepEqual(movesOf(entries), [], "the moves the filing, the start and the merge explain are no lines of their own");
});

test("a second status after the same moment is a line of its own, in its place", () => {
  const entries = feedOf({ ...bbp19(), log: observed([[1_001, "todo"], [1_002, "backlog"], [3_010, "reviewing"], [3_020, "verifying"]]) });
  assert.deepEqual(glyphsOf(entries), [["round 1 handed", 3_000, "reviewing"]]);
  assert.deepEqual(
    entries.slice(0, 5).map((entry) => [entry.kind, timeOf(entry)]),
    [
      ["created", 1_000],
      ["moved", 1_002],
      ["agent-started", 2_000],
      ["round", 3_000],
      ["moved", 3_020],
    ],
  );
  assert.deepEqual(entries[1], { kind: "moved", at: 1_002, status: "backlog" });
});

test("an issue filed before the log shows where it began, no status on anything above it, and a status logged before it never", () => {
  const plan: Logged[] = [{ at: 7_100, event: { kind: "closed", as: "accepted" } }];
  const log: Logged[] = [...observed([[900, "todo"]]), { at: 7_000, event: { kind: "log-began" } }, ...observed([[7_010, "in-review"]]), ...plan, ...observed([[7_110, "done"]])];
  const entries = feedOf({ ...bbp19(), log });
  assert.deepEqual(
    entries.slice(-3),
    [
      { kind: "logged", at: 7_000, event: { kind: "log-began" } },
      { kind: "moved", at: 7_010, status: "in-review" },
      { kind: "logged", at: 7_100, event: { kind: "closed", as: "accepted" } },
    ],
  );
  assert.deepEqual(movesOf(entries), [[7_010, "in-review"]], "the accept after the marker explains Done; nothing before it was observed");
  const filters = ["all", "rounds", "discussion"] as const satisfies readonly Filter[];
  assert.deepEqual(filters.map((filter) => entries.slice(-3).filter((entry) => shownIn(filter, entry)).length), [3, 0, 0]);
});

test("a round begun before the log shows no status on a step after the marker: the move it made is a line of its own, below it", () => {
  const spanning = handed(handoff(1, A1, 100), { state: "running", verifierThreadId: "thr_v", nudged: false, declined: [], checkout: null }, { state: "missed", at: 300, reviewerThreadId: null, reason: "no reviewer model" });
  const log: Logged[] = [{ at: 200, event: { kind: "log-began" } }, ...observed([[400, "verifying"]])];
  const entries = feedOf({ issue: { createdAt: 0 }, agents: [], handed: [spanning], finalChecks: [], decisions: [], events: [], log, comments: [], followUps: [], followUpOf: null });
  assert.deepEqual(glyphsOf(entries), [], "nothing at or above the marker shows a status, its round's later steps included");
  assert.deepEqual(
    entries.map((entry) => [entry.kind, timeOf(entry)]),
    [
      ["created", 0],
      ["round", 100],
      ["logged", 200],
      ["moved", 400],
    ],
  );
});

test("rows of the log written in one millisecond keep the order they were written: a status belongs only to what came before it", () => {
  const log: Logged[] = [...observed([[2_000, "todo"]]), { at: 2_000, event: { kind: "closed", as: "canceled" } }, ...observed([[2_001, "canceled"]])];
  const entries = feedOf({ issue: { createdAt: 0 }, agents: [], handed: [], finalChecks: [], decisions: [], events: [], log, comments: [], followUps: [], followUpOf: null });
  assert.deepEqual(entries, [
    { kind: "created", at: 0, followUpOf: null },
    { kind: "logged", at: 2_000, event: { kind: "closed", as: "canceled" } },
  ]);
});

test("a row the log kept after its start sits below the marker even when the clock stepped back: as written, with its own time", () => {
  const log: Logged[] = [{ at: 5_000, event: { kind: "log-began" } }, ...observed([[4_500, "todo"]]), { at: 4_600, event: { kind: "edited", fields: ["title"] } }];
  const entries = feedOf({ issue: { createdAt: 1_000 }, agents: [], handed: [], finalChecks: [], decisions: [], events: [], log, comments: [], followUps: [], followUpOf: null });
  assert.deepEqual(entries, [
    { kind: "created", at: 1_000, followUpOf: null },
    { kind: "logged", at: 5_000, event: { kind: "log-began" } },
    { kind: "moved", at: 4_500, status: "todo" },
    { kind: "logged", at: 4_600, event: { kind: "edited", fields: ["title"] } },
  ]);
});

test("a status belongs only to what was written before it, even when the clock stepped back between them", () => {
  const log: Logged[] = [...observed([[3_000, "todo"], [5_000, "in-progress"]]), { at: 4_000, event: { kind: "rested", rest: "backlog" } }, ...observed([[4_100, "backlog"]])];
  const entries = feedOf({ issue: { createdAt: 1_000 }, agents: [], handed: [], finalChecks: [], decisions: [], events: [], log, comments: [], followUps: [], followUpOf: null });
  assert.deepEqual(entries, [
    { kind: "created", at: 1_000, followUpOf: null },
    { kind: "moved", at: 5_000, status: "in-progress" },
    { kind: "logged", at: 4_000, event: { kind: "rested", rest: "backlog" } },
  ]);
});

/** A feed of an issue filed at 1,000 whose log is `log`, and nothing else. */
const loggedOnly = (log: Logged[]) => feedOf({ issue: { createdAt: 1_000 }, agents: [], handed: [], finalChecks: [], decisions: [], events: [], log, comments: [], followUps: [], followUpOf: null });

test("a status the moment before it doesn't say is a row of its own: a parent's title edited, then its sub-issue starting, reads Moved to In progress", () => {
  const entries = loggedOnly([...observed([[1_001, "todo"]]), { at: 2_000, event: { kind: "edited", fields: ["title"] } }, ...observed([[2_100, "in-progress"]])]);
  assert.deepEqual(entries, [
    { kind: "created", at: 1_000, followUpOf: null },
    { kind: "logged", at: 2_000, event: { kind: "edited", fields: ["title"] } },
    { kind: "moved", at: 2_100, status: "in-progress" },
  ]);
});

test("a moment whose words say the status after it explains it: set to rest, canceled, accepted as Done, accepted into In review; one saying another status doesn't", () => {
  const says = (event: Logged["event"], status: IssueStatus) => movesOf(loggedOnly([...observed([[1_001, "todo"]]), { at: 2_000, event }, ...observed([[2_100, status]])]));
  assert.deepEqual(says({ kind: "rested", rest: "backlog" }, "backlog"), []);
  assert.deepEqual(says({ kind: "closed", as: "canceled" }, "canceled"), []);
  assert.deepEqual(says({ kind: "closed", as: "accepted" }, "done"), []);
  assert.deepEqual(says({ kind: "accepted" }, "in-review"), []);
  assert.deepEqual(says({ kind: "rested", rest: "backlog" }, "in-progress"), [[2_100, "in-progress"]]);
  assert.deepEqual(says({ kind: "reopened" }, "todo"), [[2_100, "todo"]], "Reopened names no status");
});

test("comments show in the order posted among the other moments, under Discussion, and never explain a status", () => {
  const comment = (n: number, at: number, author: Comment["author"], replyTo: number | null): Comment => ({
    id: commentIdSchema.parse(`m${n}`),
    issueId: BBP_19,
    at,
    text: `Comment ${n}`,
    replyTo: replyTo === null ? null : commentIdSchema.parse(`m${replyTo}`),
    author,
  });
  const comments = [comment(1, 1_500, { kind: "user" }, null), comment(2, 1_600, { kind: "manager" }, 1), comment(3, 2_100, { kind: "agent", agentId: A1 }, 1)];
  const entries = feedOf({ issue: { createdAt: 1_000 }, agents: [agent(A1, 2_000, null)], handed: [], finalChecks: [], decisions: [], events: [], log: observed([[1_700, "todo"]]), comments, followUps: [], followUpOf: null });

  assert.deepEqual(
    entries.map((entry) => [entry.kind, timeOf(entry)]),
    [
      ["created", 1_000],
      ["comment", 1_500],
      ["comment", 1_600],
      ["agent-started", 2_000],
      ["comment", 2_100],
    ],
  );
  assert.deepEqual(movesOf(entries), [], "the move after a comment belongs to the moment before it");
  assert.deepEqual(entries.filter((entry) => shownIn("discussion", entry)).map((entry) => entry.kind), ["comment", "comment", "comment"]);
  assert.deepEqual(entries.filter((entry) => shownIn("rounds", entry)), []);
});
