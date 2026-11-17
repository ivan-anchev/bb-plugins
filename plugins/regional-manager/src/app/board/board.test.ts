import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { Board as BoardData, IssueRow } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { decisionIdSchema, type Decision } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

const { Board } = await import("./board.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");

const issue = (id: string, fields: Partial<IssueRow>): IssueRow => ({
  id: issueIdSchema.parse(id),
  kind: "build",
  title: `Title of ${id}`,
  status: "todo",
  needsYou: null,
  headline: "Not started",
  agent: null,
  branch: null,
  placing: null,
  pr: null,
  ...fields,
});
const agent = (id: string) => ({ id: agentIdSchema.parse(id), threadId: `thr_${id}` });
const decision = (id: string, answered: boolean): Decision => ({
  id: decisionIdSchema.parse(id),
  issueId: null,
  question: `Question ${id}?`,
  options: [],
  askedAt: 1_000,
  answer: answered ? { text: "Yes", at: 2_000 } : null,
});

const BLOCKED = "Blocked: Needs a staging key";

afterEach(cleanup);

/** The board as bb mounts it, reading `data`; each lane's name and the text of each of its rows, once drawn. */
async function lanesOf(data: Omit<BoardData, "verify" | "ownEdits" | "prUnavailable" | "digest">) {
  const view = renderSlot({ component: Board }, { coordinatorId: COORDINATOR }, {
    rpc: { board: () => ({ verify: true, ownEdits: null, prUnavailable: null, digest: null, ...data }), setVerify: () => ({}) },
  });
  await view.findByText("Verify done handoffs");
  return {
    view,
    lanes: view.queryAllByRole("region").flatMap((section) => {
      const heading = within(section).getByRole("heading").textContent ?? "";
      return heading === "Digest" ? [] : [[heading, within(section).queryAllByRole("listitem").map((row) => row.textContent ?? "")]];
    }),
  };
}

test("lanes are Needs you, then one per status in order; a flagged issue sits under Needs you only, showing its status; empty lanes are not shown", async () => {
  const { lanes } = await lanesOf({
    decisions: [decision("d1", false), decision("d2", true)],
    issues: [
      issue("i1", { status: "in-progress", needsYou: BLOCKED, headline: BLOCKED, agent: agent("a1") }),
      issue("i2", { status: "in-progress", headline: "Working", agent: agent("a2") }),
      issue("i3", { status: "todo" }),
      issue("i4", { status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a3") }),
      issue("i5", { status: "canceled", headline: "Canceled" }),
    ],
  });
  assert.deepEqual(
    lanes.map(([heading, rows]) => [heading, rows.length]),
    [
      ["Needs you2", 2],
      ["In review1", 1],
      ["In progress1", 1],
      ["Todo1", 1],
      ["Done1", 1],
      ["Canceled1", 1],
    ],
  );
  const [needsYou, , inProgress] = lanes.map(([, rows]) => rows);
  assert.match(needsYou?.[0] ?? "", /^d1Question d1\?/, "the lane's decisions first");
  assert.equal(needsYou?.[1], `i1Title of i1Build · In progress · a1 · ${BLOCKED}`, "the flagged issue keeps its status on the row");
  assert.equal(inProgress?.[0], "i2Title of i2Build · a2 · Working", "and is not also in its status's lane, which names no status");
});

test("a board with no issues says the regional manager files them", async () => {
  const { view, lanes } = await lanesOf({ decisions: [], issues: [] });
  assert.deepEqual(lanes, []);
  assert.ok(view.getByText(/^No issues yet\. The regional manager files one for each piece of work/));
});

test("an opened verdict names the commit it checked, and neither the provider nor the model that checked it", async () => {
  const { view } = await lanesOf({
    decisions: [],
    issues: [
      issue("i1", {
        status: "in-review",
        headline: "✓ Verified: Retries land",
        agent: agent("a1"),
        placing: {
          verdict: {
            state: "returned",
            verifierThreadId: "thr_verifier",
            headSha: "4b1d9e0c2a7f",
            checkout: { headSha: "4b1d9e0c2a7f", changedFiles: [], changedFileCount: 0 },
            criteria: [{ criterion: "Retries land", result: "pass", evidence: "3 of 3 retries landed" }],
            findings: [],
            model: { providerId: "acme-agent", model: "acme-large-7" },
            sameModel: true,
            settlement: { kind: "checked", refused: null, ci: { kind: "none" } },
          },
        },
      }),
    ],
  });
  const button = view.getByRole("button", { name: "Verdict" });
  fireEvent.click(button);
  const detail = document.getElementById(button.getAttribute("aria-controls") ?? "")?.textContent ?? "";
  assert.match(detail, /Checked 4b1d9e0/);
  assert.match(detail, /the agent's own model: no other was available/, "the warning that the check wasn't independent stays");
  assert.doesNotMatch(detail, /acme-agent|acme-large-7/);
});
