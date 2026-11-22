import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type Board as BoardData, type IssueRow } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent.ts";
import { decisionIdSchema, type Decision } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";

// The board as bb mounts it, reading the plugin: its lanes from the board's read, and its decisions'
// answers. An issue's own tab, which its row opens, is issue-tab.test.ts's.

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
const issue = (id: string, fields: Partial<IssueRow>): IssueRow => ({
  id: issueIdSchema.parse(id),
  kind: "build",
  parentId: null,
  subIssues: null,
  blockedBy: [],
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

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Read = Pick<BoardData, "decisions" | "issues">;

/**
 * The board reading `data`; each lane's name and the text of each of its rows, once drawn; `reread`,
 * the board reading `next` as it does when the plugin changes it. `answer`: what the plugin does with
 * an answer sent; it stores it unless it throws.
 */
async function mount(data: Read, answer: (input: unknown) => void = () => {}) {
  let current = data;
  let served: Read | null = null;
  const view = renderSlot({ component: Board }, { coordinatorId: COORDINATOR }, {
    experimental_rpcContract: coordinatorContract,
    rpc: {
      board: () => {
        served = current;
        return { verify: true, ownEdits: null, prUnavailable: null, ...current };
      },
      setVerify: () => ({}),
      answerDecision: (input: unknown) => {
        answer(input);
        return {};
      },
    },
  });
  await view.findByText("Verify done handoffs");
  const lanes = () =>
    view.queryAllByRole("region").flatMap((section) => {
      const heading = within(section).queryByRole("heading", { level: 2 })?.textContent ?? "";
      return heading === "" ? [] : [[heading, within(section).queryAllByRole("listitem").length] as const];
    });
  async function reread(next: Read) {
    current = next;
    await view.experimental_invalidateRpc([`board:${COORDINATOR}`]);
    // why wait: a read the answer's send started may still be running, and the board reads again after it.
    await waitFor(() => assert.equal(served, next));
    await act(async () => {});
  }
  return { view, lanes, reread };
}

test("Needs you leads with open decisions, then flagged issues showing their own status, then a lane per status in order; the last three start folded; empty lanes are not shown, and an answered decision is on none", async () => {
  const { view, lanes } = await mount({
    decisions: [decision("d1", false), decision("d2", true)],
    issues: [
      issue("WEB-1", { status: "in-progress", needsYou: BLOCKED, headline: BLOCKED, agent: agent("a1") }),
      issue("WEB-2", { status: "in-progress", headline: "Working", agent: agent("a2") }),
      issue("WEB-3", { status: "todo" }),
      issue("WEB-4", { status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a3") }),
      issue("WEB-5", { status: "canceled", headline: "Canceled" }),
    ],
  });
  assert.deepEqual(lanes(), [
    ["Needs you2", 2],
    ["In review1", 1],
    ["In progress1", 1],
    ["Todo1", 1],
    ["Canceled1", 0],
  ]);
  assert.equal(view.queryByText("Question d2?"), null, "the answered decision left the board");
  const needsYou = within(view.getByRole("region", { name: /^Needs you/ }));
  const [question, flagged] = needsYou.getAllByRole("listitem");
  assert.match(question?.textContent ?? "", /^d1Question d1\?/, "the lane's decisions first");
  assert.ok(flagged !== undefined && within(flagged).getByRole("img", { name: "In progress" }), "the flagged issue shows its status");
  assert.equal(within(view.getByRole("region", { name: /^In progress/ })).queryByRole("button", { name: /\bWEB-1 Build/ }), null, "and is not also in its status's lane");
});

test("a row says why a check is waiting or stalled: its verifier asking, or no activity from it", async () => {
  const asking = "Verifying, its verifier asking for an answer or an approval, which the plugin declines: Retries land with backoff";
  const stalled = "Couldn't verify, as its verifier showed no activity for 30 minutes: Retries land with backoff";
  const { view } = await mount({
    decisions: [],
    issues: [issue("WEB-1", { status: "verifying", headline: asking, agent: agent("a1") }), issue("WEB-2", { status: "in-progress", needsYou: stalled, headline: stalled, agent: agent("a2") })],
  });
  assert.ok(view.getByRole("button", { name: new RegExp(`\\bWEB-1 Build.*${asking}`) }));
  assert.ok(view.getByRole("button", { name: new RegExp(`\\bWEB-2 Build.*${stalled.replace(/[()]/g, "\\$&")}`) }));
});

test("a research row reads Research, with no pull request", async () => {
  const { view } = await mount({ decisions: [], issues: [issue("WEB-2", { kind: "research", status: "done", headline: "Handed off: Vault fits our PCI scope", agent: agent("a2") })] });
  fireEvent.click(view.getByRole("button", { name: /^Done/ }));
  assert.ok(view.getByRole("button", { name: /\bWEB-2 Research: Title of WEB-2/ }));
  assert.equal(view.queryByRole("link", { name: /^Pull request/ }), null);
});

test("a board with no issues says so", async () => {
  const { view, lanes } = await mount({ decisions: [], issues: [] });
  assert.deepEqual(lanes(), []);
  assert.ok(view.getByText("No issues yet."));
});

const DRAFT_KEY = `coordinator-decision-answer:${COORDINATOR}:d1`;
const type = (view: Awaited<ReturnType<typeof mount>>["view"], text: string) => fireEvent.change(view.getByRole("textbox", { name: "Your answer" }), { target: { value: text } });

test("an answer sent and read back answered leaves the board, and nothing in the browser", async () => {
  const sent: unknown[] = [];
  const { view, reread } = await mount({ decisions: [decision("d1", false)], issues: [] }, (input) => sent.push(input));
  type(view, "A typed answer");
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("A typed answer"));

  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  assert.deepEqual(sent, [{ coordinatorId: COORDINATOR, decisionId: "d1", answer: "A typed answer" }]);
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("A typed answer"), "kept until the board reads it answered");
  await reread({ decisions: [{ ...decision("d1", false), answer: { text: "A typed answer", at: 2_000 } }], issues: [] });

  assert.equal(view.queryByText("Question d1?"), null, "the answered decision left the board");
  assert.equal(localStorage.length, 0);
});

test("a decision answered elsewhere drops the answer typed here, and one left from before is dropped on the next read", async () => {
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
