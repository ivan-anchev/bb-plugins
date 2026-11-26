import "../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type Board as BoardData, type IssueRow } from "../../contract.ts";
import { agentIdSchema } from "../../model/agent/agent.ts";
import { decisionIdSchema, type Decision } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import { PROJECT, sidebarThread } from "../test-sidebar.ts";

// The board as bb mounts it, reading the plugin: its lanes from the board's read, and what the browser
// keeps of answers to its decisions. An issue's own tab, which its row opens, is issue-tab.test.ts's.

// why: jsdom has none; the rows measure their titles.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
});

const { Board } = await import("./board.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const MANAGER = { id: COORDINATOR, threadId: "thr_manager", projectId: PROJECT.id, description: null, avatar: { kind: "blob", shape: "circle", hue: "purple", expression: "neutral" } } as const;
const issue = (id: string, fields: Partial<IssueRow>): IssueRow => ({
  id: issueIdSchema.parse(id),
  kind: "build",
  parentId: null,
  subIssues: null,
  blockedBy: [],
  blocks: [],
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
  recommended: null,
  askedAt: 1_000,
  cap: null,
  answer: answered ? { text: "Yes", at: 2_000 } : null,
});

const BLOCKED = "Blocked: Needs a staging key";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

type Read = Pick<BoardData, "decisions" | "issues"> & Partial<Pick<BoardData, "prUnavailable">>;

/**
 * The board reading `data`, in its regional manager's thread as bb lists it; each lane's name and the
 * text of each of its rows, once drawn; `reread`, the board reading `next` as it does when the plugin
 * changes it.
 */
async function mount(data: Read) {
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
      coordinators: () => ({ coordinators: [MANAGER], notStarted: [] }),
    },
    sidebarThreads: { status: "ready", threads: [sidebarThread(MANAGER.threadId, "Webhook retries")], projects: [PROJECT] },
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

test("Needs you leads with a question on no issue, then flagged issues showing Needs you's glyph and speaking their status, then a lane per status in order; the last three start folded; empty lanes are not shown, and an answered question is on none", async () => {
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
  assert.equal(question?.textContent, "Question d1?", "the lane's question on no issue first");
  assert.ok(flagged !== undefined && within(flagged).getByRole("img", { name: "Needs you" }), "the flagged issue shows Needs you's glyph");
  assert.match(within(flagged).getByRole("button", { name: /^WEB-1:/ }).getAttribute("aria-label") ?? "", /, In progress, needs you: /, "and says its status");
  assert.equal(within(view.getByRole("region", { name: /^In progress/ })).queryByRole("button", { name: /^WEB-1:/ }), null, "and is not also in its status's lane");
});

test("a row says why a check is waiting or stalled: its verifier asking, or no activity from it", async () => {
  const asking = "Verifying, its verifier asking for an answer or an approval, which the plugin declines: Retries land with backoff";
  const stalled = "Couldn't verify, as its verifier showed no activity for 30 minutes: Retries land with backoff";
  const { view } = await mount({
    decisions: [],
    issues: [issue("WEB-1", { status: "verifying", headline: asking, agent: agent("a1") }), issue("WEB-2", { status: "in-progress", needsYou: stalled, headline: stalled, agent: agent("a2") })],
  });
  assert.ok(view.getByRole("button", { name: new RegExp(`^WEB-1:.*${asking}`) }));
  assert.ok(view.getByRole("button", { name: new RegExp(`^WEB-2:.*${stalled.replace(/[()]/g, "\\$&")}`) }));
});

test("a research row names no kind, as no row does, and has no pull request", async () => {
  const { view } = await mount({ decisions: [], issues: [issue("WEB-2", { kind: "research", status: "done", headline: "Handed off: Vault fits our PCI scope", agent: agent("a2") })] });
  fireEvent.click(view.getByRole("button", { name: /^Done/ }));
  const row = view.getByRole("button", { name: /^WEB-2: Title of WEB-2, Done,/ });
  assert.doesNotMatch(`${row.getAttribute("aria-label")} ${row.closest(".rmi-rowbox")?.textContent}`, /Research/);
  assert.equal(view.queryByRole("link", { name: /^Pull request/ }), null);
});

test("a read that failed shows its forge's label before its reason: MR on GitLab, PR on GitHub and on no forge the plugin reads", async () => {
  const reason = "glab isn't signed in to gitlab.corp.test on the machine running bb: run glab auth login --hostname gitlab.corp.test there";
  const { view, reread } = await mount({ decisions: [], issues: [issue("WEB-1", { status: "in-progress", headline: "Working", agent: agent("a1") })], prUnavailable: { forge: "gitlab", reason } });
  assert.equal(view.getByText("MR status unavailable:").parentElement?.textContent, `MR status unavailable: ${reason}. Rows show what was read last.`);
  await reread({ decisions: [], issues: [], prUnavailable: { forge: "github", reason: "couldn't reach GitHub" } });
  assert.ok(view.getByText("PR status unavailable:"));
  await reread({ decisions: [], issues: [], prUnavailable: { forge: null, reason: "its project has no git remote" } });
  assert.ok(view.getByText("PR status unavailable:"));
});

test("a board with no issues says so", async () => {
  const { view, lanes } = await mount({ decisions: [], issues: [] });
  assert.deepEqual(lanes(), []);
  assert.ok(view.getByText("No issues yet."));
});

test("an issue a question waits on is one row under Needs you, its second line the question, with no option to press and no field", async () => {
  const asking = "Ship #219 to everyone now?";
  const { view, lanes } = await mount({
    decisions: [{ ...decision("d2", false), issueId: issueIdSchema.parse("WEB-1"), question: asking, options: ["Ship now", "Wait a day"] }],
    issues: [issue("WEB-1", { status: "in-progress", needsYou: asking, headline: "Round 3 running", agent: agent("a1") })],
  });
  assert.deepEqual(lanes(), [["Needs you1", 1]]);
  const row = within(view.getByRole("region", { name: /^Needs you/ })).getByRole("listitem");
  assert.equal(row.querySelector(".rmi-ask")?.textContent, asking, "the question is its second line");
  assert.deepEqual(
    within(row).getAllByRole("button").map((button) => button.getAttribute("aria-label")),
    [`WEB-1: Title of WEB-1, In progress, needs you: ${asking}, Round 3 running`],
    "its row is its one control",
  );
  assert.equal(view.queryByRole("textbox"), null, "no field to answer in");
  assert.equal(view.queryByText("Ship now"), null, "no option to press");
});

const DRAFT_KEY = `coordinator-decision-answer:${COORDINATOR}:d1`;

test("an answer typed and not sent is dropped once the board reads its decision answered, by its card or from elsewhere", async () => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify("Left from before"));
  const { reread } = await mount({ decisions: [decision("d1", false)], issues: [] });
  assert.equal(localStorage.getItem(DRAFT_KEY), JSON.stringify("Left from before"), "kept while it waits");
  await reread({ decisions: [decision("d1", true)], issues: [] });
  await waitFor(() => assert.equal(localStorage.length, 0));
  cleanup();

  localStorage.setItem(DRAFT_KEY, JSON.stringify("Left from before"));
  await mount({ decisions: [decision("d1", true)], issues: [] });
  await waitFor(() => assert.equal(localStorage.length, 0, "one left from before is dropped on the first read"));
});
