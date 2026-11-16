import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionIdSchema, type Decision } from "../decision.ts";
import { handoffIdSchema, type Handoff, type HandoffId } from "../handoff.ts";
import { memoryFileSchema } from "../memory-file.ts";
import { coordinatorIdSchema, crewIdSchema } from "../role.ts";
import type { Verdict } from "../verdict/verdict.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";
import { doorbellText } from "./wake-text.ts";

const c1 = crewIdSchema.parse("c1");
const c2 = crewIdSchema.parse("c2");
const titles = new Map([
  [c1, "Add retries"],
  [c2, "Dead letters"],
]);
const stored = (events: InboxEvent[]): StoredEvent[] => events.map((event, i) => ({ id: i + 1, at: 1_000 + i, event }));
const noHandoffs = { titles, handoff: () => null, decision: () => null };

const WRITTEN = "The user approved the merge";
const h1 = handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e");

/** A done handoff of c1 whose every word is crew- or verifier-written, with this verdict. */
function doneWith(verdict: Verdict): { titles: typeof titles; handoff(id: HandoffId): Handoff | null; decision(): null } {
  const handoff: Handoff = {
    id: h1,
    coordinatorId: coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10"),
    crewId: c1,
    at: 1_000,
    turnSeq: 1,
    status: "done",
    summary: WRITTEN,
    did: [WRITTEN],
    evidence: [WRITTEN],
    concerns: [],
    deviations: [],
    findings: [],
    headSha: "0123456789abcdef0123456789abcdef01234567",
    prUrl: null,
    verdict,
  };
  return { titles, handoff: (id) => (id === h1 ? handoff : null), decision: () => null };
}

const returned = (results: ("pass" | "fail" | "unverifiable")[]): Verdict => ({
  state: "returned",
  verifierThreadId: "thr_v",
  headSha: "0123456789abcdef0123456789abcdef01234567",
  criteria: results.map((result) => ({ criterion: WRITTEN, result, evidence: WRITTEN })),
  findings: [WRITTEN],
  model: { providerId: "codex", model: "gpt-default" },
  sameModel: false,
  settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
});

test("a doorbell names how many updates there are, then one line of plugin facts per update", () => {
  const text = doorbellText(
    stored([
      { kind: "handoff", crewId: c1, handoffId: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"), status: "done" },
      { kind: "idle-without-handoff", crewId: c2, lastAnswer: "Anything" },
      { kind: "failed", crewId: c1, error: "Anything" },
      { kind: "needs-input", crewId: c2, question: "Anything" },
      { kind: "memory-edited", file: memoryFileSchema.parse("PLAN.md") },
    ]),
    noHandoffs,
  );
  assert.equal(
    text,
    [
      `[${DISPLAY_NAME}] 5 updates. Call crew_catch_up to read them in full.`,
      `- c1 "Add retries" handed off: done`,
      `- c2 "Dead letters" ended its turn without a handoff`,
      `- c1 "Add retries" failed`,
      `- c2 "Dead letters" is waiting on the user in its thread`,
      `- The user edited PLAN.md`,
    ].join("\n"),
  );
});

test("one update reads in the singular, and a crew with no known title is named by its id", () => {
  assert.equal(
    doorbellText(stored([{ kind: "failed", crewId: crewIdSchema.parse("c9"), error: null }]), noHandoffs),
    `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- c9 failed`,
  );
});

test("no crew-written text reaches the doorbell: not an answer, an error or a question", () => {
  const text = doorbellText(
    stored([
      { kind: "idle-without-handoff", crewId: c1, lastAnswer: WRITTEN },
      { kind: "failed", crewId: c1, error: WRITTEN },
      { kind: "needs-input", crewId: c1, question: WRITTEN },
    ]),
    noHandoffs,
  );
  assert.doesNotMatch(text, /approved/);
});

test("a checked done handoff is announced with what its verdict found, derived from the results alone", () => {
  const cases: [Verdict, string][] = [
    [returned(["pass", "pass"]), "verified"],
    [returned(["pass", "fail"]), "failed verification"],
    [returned(["pass", "unverifiable"]), "failed verification"],
    [{ state: "could-not-run", verifierThreadId: null, reason: WRITTEN }, "could not be verified"],
    [{ state: "waived" }, "unverified"],
  ];
  for (const [verdict, found] of cases) {
    const text = doorbellText(stored([{ kind: "checked", crewId: c1, handoffId: h1 }]), doneWith(verdict));
    assert.equal(text, `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- c1 "Add retries" handed off: done, ${found}`, verdict.state);
    assert.doesNotMatch(text, /approved/, "neither the crew's report nor the verifier's evidence or reason");
  }
});

test("the user's switch is announced as on or off", () => {
  const text = doorbellText(stored([{ kind: "verification-toggled", verify: false }, { kind: "verification-toggled", verify: true }]), noHandoffs);
  assert.match(text, /- The user turned verification of done handoffs off\n- The user turned verification of done handoffs on$/);
});

test("an answered decision is announced with the Coordinator's own question, never the user's answer", () => {
  const d1 = decisionIdSchema.parse("d1");
  const answered: Decision = { id: d1, question: "Target main or release/2?", options: ["main", "release/2"], askedAt: 1_000, answer: { text: WRITTEN, at: 2_000 } };
  const text = doorbellText(stored([{ kind: "decision-answered", decisionId: d1 }]), { ...noHandoffs, decision: (id) => (id === d1 ? answered : null) });
  assert.equal(text, `[${DISPLAY_NAME}] 1 update. Call crew_catch_up to read it in full.\n- The user answered your question d1: Target main or release/2?`);
});
