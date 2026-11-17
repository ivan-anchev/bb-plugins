import "../test-browser.ts";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type Board as BoardData, type IssueDetail, type IssueRow } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { decisionIdSchema, type Decision } from "../../model/decision.ts";
import { handoffIdSchema } from "../../model/handoff.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

// The board as bb mounts it, reading the plugin: its lanes from the board's read, and an issue's
// detail from the `issue` read, made only when its row opens.

// why: the board brings its stylesheet, which bb's build bundles and node can't load.
registerHooks({ load: (url, context, nextLoad) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context)) });
// why: jsdom has none of these; the rows measure their titles, and the working ring asks for Reduce motion and a canvas.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;

const { Board } = await import("./board.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const SHA = "4b1d9e0c2a7f3e5d6c8b9a0f1e2d3c4b5a697881";

const issue = (id: string, fields: Partial<IssueRow>): IssueRow => ({
  id: issueIdSchema.parse(id),
  kind: "build",
  title: `Title of ${id}`,
  status: "todo",
  needsYou: null,
  headline: "Not started",
  agent: null,
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

const DETAIL: IssueDetail = {
  description: "Failed webhook deliveries are lost.",
  doneCriteria: ["Retries land", "npm test passes"],
  record: [
    {
      agent: { id: agentIdSchema.parse("a1"), threadId: "thr_a1", ended: null },
      handoffs: [
        {
          id: handoffIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10"),
          at: 2_000,
          status: "done",
          summary: "Retries land with backoff",
          did: ["Added exponential backoff"],
          evidence: ["$ npm test"],
          concerns: [],
          deviations: [],
          findings: [],
          verdict: {
            state: "returned",
            verifierThreadId: "thr_verifier",
            headSha: SHA,
            checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
            criteria: [
              { criterion: "Retries land", result: "pass", evidence: "3 of 3 retries landed" },
              { criterion: "npm test passes", result: "fail", evidence: "$ npm test\n1 failing: caps the backoff" },
            ],
            findings: [],
            sameModel: true,
            settlement: { kind: "checked", ci: { kind: "none" } },
          },
        },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Read = Pick<BoardData, "decisions" | "issues">;

/**
 * The board reading `data`, and every issue it read in `opened`; each lane's name and the text of each
 * of its rows, once drawn; `reread`, the board reading `next` as it does when the plugin changes it.
 * `answer`: what the plugin does with an answer sent; it stores it unless it throws.
 */
async function mount(data: Read, answer: (input: unknown) => void = () => {}) {
  const opened: unknown[] = [];
  let current = data;
  let served: Read | null = null;
  const view = renderSlot({ component: Board }, { coordinatorId: COORDINATOR }, {
    experimental_rpcContract: coordinatorContract,
    rpc: {
      board: () => {
        served = current;
        return { verify: true, ownEdits: null, prUnavailable: null, digest: null, ...current };
      },
      setVerify: () => ({}),
      answerDecision: (input: unknown) => {
        answer(input);
        return {};
      },
      issue: (input: unknown) => {
        opened.push(input);
        return DETAIL;
      },
    },
  });
  await view.findByText("Verify done handoffs");
  const lanes = () =>
    view.queryAllByRole("region").flatMap((section) => {
      const heading = within(section).queryByRole("heading", { level: 2 })?.textContent ?? "";
      return heading === "" || heading === "Digest" ? [] : [[heading, within(section).queryAllByRole("listitem").length] as const];
    });
  async function reread(next: Read) {
    current = next;
    await view.experimental_invalidateRpc([`board:${COORDINATOR}`]);
    // why wait: a read the answer's send started may still be running, and the board reads again after it.
    await waitFor(() => assert.equal(served, next));
    await act(async () => {});
  }
  return { view, opened, lanes, reread };
}

test("Needs you leads with open decisions, then flagged issues showing their own status, then a lane per status in order; the last three start folded; empty lanes are not shown", async () => {
  const { view, lanes } = await mount({
    decisions: [decision("d1", false), decision("d2", true)],
    issues: [
      issue("i1", { status: "in-progress", needsYou: BLOCKED, headline: BLOCKED, agent: agent("a1") }),
      issue("i2", { status: "in-progress", headline: "Working", agent: agent("a2") }),
      issue("i3", { status: "todo" }),
      issue("i4", { status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a3") }),
      issue("i5", { status: "canceled", headline: "Canceled" }),
    ],
  });
  assert.deepEqual(lanes(), [
    ["Needs you2", 2],
    ["In review1", 1],
    ["In progress1", 1],
    ["Todo1", 1],
    ["Done1", 0],
    ["Canceled1", 0],
  ]);
  const needsYou = within(view.getByRole("region", { name: /^Needs you/ }));
  const [question, flagged] = needsYou.getAllByRole("listitem");
  assert.match(question?.textContent ?? "", /^d1Question d1\?/, "the lane's decisions first");
  assert.ok(flagged !== undefined && within(flagged).getByRole("img", { name: "In progress" }), "the flagged issue shows its status");
  assert.equal(within(view.getByRole("region", { name: /^In progress/ })).queryByRole("button", { name: /\bi1 Build/ }), null, "and is not also in its status's lane");
});

test("a row opens in place to the issue read from the plugin, and only then: its description, Done when and record, each verdict's failures open", async () => {
  const { view, opened } = await mount({ decisions: [], issues: [issue("i1", { status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a1") }), issue("i2", {})] });
  assert.deepEqual(opened, [], "nothing is read before a row opens");

  const row = view.getByRole("button", { name: /\bi1 Build/ });
  fireEvent.click(row);
  const detail = within(view.getByRole("region", { name: "i1: Title of i1" }));
  await detail.findByText(DETAIL.description);
  assert.deepEqual(opened, [{ coordinatorId: COORDINATOR, issueId: "i1" }]);
  assert.deepEqual(
    detail.getAllByRole("listitem").slice(0, 2).map((item) => item.textContent),
    DETAIL.doneCriteria,
  );
  assert.ok(detail.getByText("Done when"));
  assert.ok(detail.getByText("1 of 2 criteria passed"));
  assert.match(detail.getByLabelText("Evidence for criterion 2").textContent ?? "", /1 failing/);
  assert.equal(detail.getByLabelText("Evidence for criterion 2").closest("details")?.open, true);
  assert.equal(detail.getByLabelText("Evidence for criterion 1").closest("details")?.open, false);
  assert.ok(detail.getByText(/on the agent's own model/));

  fireEvent.click(row);
  assert.equal(view.queryByRole("region", { name: "i1: Title of i1" }), null);
});

test("a board with no issues says so", async () => {
  const { view, lanes } = await mount({ decisions: [], issues: [] });
  assert.deepEqual(lanes(), []);
  assert.ok(view.getByText("No issues yet."));
});

const DRAFT_KEY = `coordinator-decision-answer:${COORDINATOR}:d1`;
const type = (view: Awaited<ReturnType<typeof mount>>["view"], text: string) => fireEvent.change(view.getByRole("textbox", { name: "Your answer" }), { target: { value: text } });

test("an answer sent and read back answered while Done is folded leaves nothing in the browser", async () => {
  const sent: unknown[] = [];
  const { view, reread } = await mount({ decisions: [decision("d1", false)], issues: [] }, (input) => sent.push(input));
  type(view, "A typed answer");
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("A typed answer"));

  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  assert.deepEqual(sent, [{ coordinatorId: COORDINATOR, decisionId: "d1", answer: "A typed answer" }]);
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("A typed answer"), "kept until the board reads it answered");
  await reread({ decisions: [{ ...decision("d1", false), answer: { text: "A typed answer", at: 2_000 } }], issues: [] });

  assert.equal(view.getByRole("button", { name: /^Done/ }).getAttribute("aria-expanded"), "false", "Done is folded");
  assert.equal(localStorage.length, 0);
});

test("a decision answered elsewhere drops the answer typed here while Done is folded, and one left from before is dropped on the next read", async () => {
  const { view, reread } = await mount({ decisions: [decision("d1", false)], issues: [] });
  type(view, "Not sent");
  await reread({ decisions: [decision("d1", true)], issues: [] });
  assert.equal(localStorage.length, 0);
  cleanup();

  localStorage.setItem(DRAFT_KEY, JSON.stringify("Left from before"));
  await mount({ decisions: [decision("d1", true)], issues: [] });
  await waitFor(() => assert.equal(localStorage.length, 0));
});

test("a send the plugin refuses keeps the answer typed, in the field and in the browser", async () => {
  const { view } = await mount({ decisions: [decision("d1", false)], issues: [] }, () => {
    throw new Error("bb is restarting");
  });
  type(view, "Kept");
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await view.findByText(/Could not send your answer/);
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("Kept"));
  const field = view.getByRole("textbox", { name: "Your answer" });
  assert.ok(field instanceof HTMLTextAreaElement && field.value === "Kept");
});
