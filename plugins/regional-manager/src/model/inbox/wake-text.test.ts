import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../agent/agent.ts";
import { decisionIdSchema, type Decision } from "../decision.ts";
import { handoffIdSchema } from "../agent/handoff.ts";
import { issueIdSchema } from "../issue/issue.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { coordinatorIdSchema } from "../role.ts";
import { checkIdSchema, type Check, type CheckId } from "../verdict/check.ts";
import type { CapQuestion } from "../verdict/rounds/cap.ts";
import type { Verdict } from "../verdict/verdict.ts";
import { commentIdSchema } from "../feed/comment.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";
import { doorbellText } from "./wake-text.ts";

const i1 = issueIdSchema.parse("WEB-1");
const i2 = issueIdSchema.parse("WEB-2");
const a1 = agentIdSchema.parse("a1");
const a2 = agentIdSchema.parse("a2");
const titles = new Map([
  [i1, "Add retries"],
  [i2, "Dead letters"],
]);
const stored = (events: InboxEvent[]): StoredEvent[] => events.map((event, i) => ({ id: i + 1, at: 1_000 + i, event }));
const noChecks = { titles, check: () => null, decision: () => null };

const WRITTEN = "The user approved the merge";
const k1 = checkIdSchema.parse("5d6c1e0a-2b3f-4a5e-8c7d-9e0f1a2b3c4d");

/** A check of a done handoff of a1 on WEB-1 whose every word is agent- or verifier-written, with this verdict. */
function checkedWith(verdict: Verdict, asked: CapQuestion | null = null): Parameters<typeof doorbellText>[1] {
  const check: Check = {
    id: k1,
    coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
    issueId: i1,
    at: 1_000,
    criteria: [WRITTEN],
    verifier: null,
    subject: { kind: "handoff", agentId: a1, handoffId: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), headSha: "0123456789abcdef0123456789abcdef01234567", prUrl: null, branch: null },
    review: { state: "none" },
    verdict,
    followUpId: null,
    acceptedAt: null,
  };
  return { titles, check: (id) => (id === k1 ? check : null), decision: (id) => (id === asked?.id ? asked : null) };
}

const returned = (results: ("pass" | "fail" | "unverifiable")[]): Verdict => ({
  state: "returned", at: 5_000,
  verifierThreadId: "thr_v",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  checkout: { headSha: "0123456789abcdef0123456789abcdef01234567", changedFiles: [], changedFileCount: 0 },
  criteria: results.map((result) => ({ criterion: WRITTEN, result, shows: "Ran it.", evidence: WRITTEN })),
  findings: [{ severity: "should-fix", title: WRITTEN, detail: WRITTEN }],
  blocking: [],
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  triage: [],
  mustFixFails: true,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});

test("a doorbell names how many updates there are, then one line of plugin facts per update", () => {
  const text = doorbellText(
    stored([
      { kind: "handoff", issueId: i1, agentId: a1, handoffId: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), status: "blocked" },
      { kind: "idle-without-handoff", issueId: i2, agentId: a2, lastAnswer: "Anything" },
      { kind: "failed", issueId: i1, agentId: a1, error: "Anything" },
      { kind: "needs-input", issueId: i2, agentId: a2, question: "Anything" },
      { kind: "returned-to-todo", issueId: i2, agentId: a2, how: "archived" },
      { kind: "memory-edited", file: memoryFileSchema.parse("NOTES.md") },
      { kind: "comment-to-you", issueId: i1, commentId: commentIdSchema.parse("m1") },
      { kind: "comment", issueId: i1, agentId: a1, commentId: commentIdSchema.parse("m2") },
    ]),
    noChecks,
  );
  assert.equal(
    text,
    [
      `[${DISPLAY_NAME}] 8 updates. Call crew_catch_up to read them in full.`,
      `- WEB-1 "Add retries" (a1) handed off: blocked`,
      `- WEB-2 "Dead letters" (a2) ended its turn without a handoff`,
      `- WEB-1 "Add retries" (a1) failed`,
      `- WEB-2 "Dead letters" (a2) is waiting on the user in its thread`,
      `- WEB-2 "Dead letters" (a2) returned to Todo: its agent was archived`,
      `- The user edited NOTES.md`,
      `- The user commented on WEB-1 "Add retries": m1`,
      `- WEB-1 "Add retries" (a1) commented: m2`,
    ].join("\n"),
  );
});

test("one update reads in the singular, and an issue with no known title is named by its id", () => {
  assert.equal(
    doorbellText(stored([{ kind: "failed", issueId: issueIdSchema.parse("WEB-9"), agentId: agentIdSchema.parse("a9"), error: null }]), noChecks),
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- WEB-9 (a9) failed`,
  );
});

test("no agent-written text reaches the doorbell: not an answer, an error or a question", () => {
  const text = doorbellText(
    stored([
      { kind: "idle-without-handoff", issueId: i1, agentId: a1, lastAnswer: WRITTEN },
      { kind: "failed", issueId: i1, agentId: a1, error: WRITTEN },
      { kind: "needs-input", issueId: i1, agentId: a1, question: WRITTEN },
    ]),
    noChecks,
  );
  assert.doesNotMatch(text, /approved/);
});

test("a checked done handoff is announced with what its verdict found, derived from the results alone", () => {
  const cases: [Verdict, string][] = [
    [returned(["pass", "pass"]), "verified"],
    [returned(["pass", "fail"]), "failed verification"],
    [returned(["pass", "unverifiable"]), "failed verification"],
    [{ state: "could-not-run", at: 5_000, verifierThreadId: null, reason: WRITTEN }, "could not be verified"],
    [{ state: "waived" }, "unverified"],
  ];
  for (const [verdict, found] of cases) {
    const text = doorbellText(stored([{ kind: "checked", issueId: i1, checkId: k1, asked: null }]), checkedWith(verdict));
    assert.equal(text, `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- WEB-1 "Add retries" (a1) handed off: done, ${found}`, verdict.state);
    assert.doesNotMatch(text, /approved/, "neither the agent's report nor the verifier's evidence or reason");
  }
});

test("a failure whose settling asked the user at the issue's cap says so with the question's id and count; one that asked nothing doesn't", () => {
  const failed = returned(["pass", "fail"]);
  const d4 = decisionIdSchema.parse("d4");
  const question: CapQuestion = { id: d4, issueId: i1, question: "Anything", options: [], recommended: null, askedAt: 6_000, answer: null, cap: 4 };
  assert.equal(
    doorbellText(stored([{ kind: "checked", issueId: i1, checkId: k1, asked: d4 }]), checkedWith(failed, question)),
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- WEB-1 "Add retries" (a1) handed off: done, failed verification; WEB-1's 4th failed verification, past its cap of 3: nothing went back to an agent, and the plugin asked the user (d4)`,
  );
  assert.doesNotMatch(doorbellText(stored([{ kind: "checked", issueId: i1, checkId: k1, asked: null }]), checkedWith(failed, question)), /asked the user/);
});

test("a failure that asked at the cap while its findings may have reached its agent says that, not that nothing went back", () => {
  const failed = returned(["pass", "fail"]);
  const maybe: Verdict = failed.state === "returned" ? { ...failed, settlement: { kind: "maybe-sent-back", round: 1, ci: { kind: "none" } } } : assert.fail("not returned");
  const d1 = decisionIdSchema.parse("d1");
  const question: CapQuestion = { id: d1, issueId: i1, question: "Anything", options: [], recommended: null, askedAt: 6_000, answer: null, cap: 3 };
  const text = doorbellText(stored([{ kind: "checked", issueId: i1, checkId: k1, asked: d1 }]), checkedWith(maybe, question));
  assert.match(text, /WEB-1's 3rd failed verification, its cap: its findings may have reached its agent, as the plugin stopped while sending them; nothing more goes back to one, and the plugin asked the user \(d1\)$/);
  assert.doesNotMatch(text, /nothing went back/);
});

test("the user's switch is announced as on or off", () => {
  const text = doorbellText(stored([{ kind: "verification-toggled", verify: false }, { kind: "verification-toggled", verify: true }]), noChecks);
  assert.match(text, /- The user turned verification of done handoffs off\n- The user turned verification of done handoffs on$/);
});

test("an answered decision is announced with the regional manager's own question, never the user's answer", () => {
  const d1 = decisionIdSchema.parse("d1");
  const answered: Decision = { id: d1, issueId: null, question: "Target main or release/2?", options: ["main", "release/2"], recommended: null, askedAt: 1_000, answer: { text: WRITTEN, at: 2_000 }, cap: null };
  const text = doorbellText(stored([{ kind: "decision-answered", decisionId: d1 }]), { ...noChecks, decision: (id) => (id === d1 ? answered : null) });
  assert.equal(text, `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- The user answered your question d1: Target main or release/2?`);
});
