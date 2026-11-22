import "../../test-browser.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type IssueDetail, type IssueRow } from "../../../contract.ts";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import { decisionIdSchema } from "../../../model/decision.ts";
import { handoffIdSchema } from "../../../model/agent/handoff.ts";
import { memoryFileSchema } from "../../../model/memory-file.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import type { ShownVerdict } from "../../../model/verdict/verdict.ts";
import { PROJECT } from "../../test-sidebar.ts";
import { shortTime } from "../../ui/time.ts";

// An issue's own tab as bb mounts it in its regional manager's side panel, with the params it was
// opened with, reading the plugin: the issue's row and the rows its relations name from the board's
// read, its detail from the `issue` read. bb hands the same params back after a reload, so a tab
// mounted with them is the tab that survived one.

// why: jsdom has none of these; the working ring asks for Reduce motion and a canvas.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;

const { issueTab } = await import("./issue-tab.tsx");

afterEach(cleanup);

const COORDINATOR = { id: "6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10", threadId: "thr_1", projectId: PROJECT.id, description: null, avatar: { kind: "blob", shape: "circle", hue: "violet", expression: "neutral" } };
const SHA = "4b1d9e0c2a7f3e5d6c8b9a0f1e2d3c4b5a697881";

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
const id = (raw: string) => issueIdSchema.parse(raw);
const agent = (id: string) => ({ id: agentIdSchema.parse(id), threadId: `thr_${id}` });

const DETAIL: IssueDetail = {
  description: "Failed webhook deliveries are lost.",
  doneCriteria: ["Retries land", "npm test passes"],
  dependsOn: [],
  blocks: [],
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
          report: null,
          verdict: {
            state: "returned", at: 5_000,
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
  finalChecks: [],
  decisions: [],
};

const REPORT = "## Recommendation\n\nVault: it keeps card data **inside** our PCI scope.";

/** A research issue asked `questions`, whose agent handed off a report. */
const researched = (questions: string[]): IssueDetail => ({
  description: "Which vault fits our PCI scope.",
  doneCriteria: questions,
  dependsOn: [],
  blocks: [],
  record: [
    {
      agent: { id: agentIdSchema.parse("a2"), threadId: "thr_a2", ended: null },
      handoffs: [
        {
          id: handoffIdSchema.parse("0b0e8f3e-8b2a-4c5f-9d0e-2f6a1c3b4d5e"),
          at: 3_000,
          status: "done",
          summary: "Vault fits our PCI scope",
          did: ["Read both vendors' PCI guides"],
          evidence: [],
          concerns: [],
          deviations: [],
          findings: [],
          report: { report: REPORT, file: memoryFileSchema.parse("reports/WEB-2.md") },
          verdict: null,
        },
      ],
    },
  ],
  finalChecks: [],
  decisions: [],
});

/**
 * The tab opened with `params` in the manager's thread, over a board of `issues`, each issue's
 * detail `detailOf` its id; every issue read in `opened`. `reread`, the board reading `next` as it
 * does when the plugin changes it. Its side panel accepts every tab it is asked to open.
 */
async function mount(params: JsonValue | null, issues: readonly IssueRow[], detailOf: (issueId: string) => IssueDetail = () => DETAIL) {
  const opened: unknown[] = [];
  let current = issues;
  const view = renderSlot(
    { component: issueTab.component },
    { threadId: COORDINATOR.threadId, environment: null, params },
    {
      experimental_rpcContract: coordinatorContract,
      experimental_panel: { openTab: () => true },
      rpc: {
        coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }),
        board: () => ({ verify: true, ownEdits: null, prUnavailable: null, decisions: [], issues: current }),
        issue: (input: unknown) => {
          opened.push(input);
          return detailOf(coordinatorContract.issue.input.parse(input).issueId);
        },
      },
    },
  );
  async function reread(next: readonly IssueRow[]) {
    current = next;
    await view.experimental_invalidateRpc([`board:${COORDINATOR.id}`]);
    await act(async () => {});
  }
  return { view, opened, reread, tab: () => within(view.getByRole("article")) };
}

/** Opened on `issueId`, once its detail has drawn. */
async function opened(issueId: string, issues: readonly IssueRow[], detailOf: (issueId: string) => IssueDetail = () => DETAIL) {
  const mounted = await mount({ issueId }, issues, detailOf);
  await within(await mounted.view.findByRole("article", { name: issueId })).findByText(detailOf(issueId).description);
  return mounted;
}

const section = (tab: ReturnType<typeof within>, name: string) =>
  within(tab.getByRole("heading", { name }).closest("section") ?? assert.fail(`no ${name}`)).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
const headings = (tab: ReturnType<typeof within>) => tab.getAllByRole("heading", { level: 3 }).map((heading: HTMLElement) => heading.textContent);

/** The issue tab bb is asked to open, as the side panel's `openTab` gets it. */
const issueTabCall = (id: string, title: string) => ({ method: "openTab", options: { tab: { id: "issue", context: { kind: "thread" }, availability: "action" }, params: { issueId: id }, title: `${id} ${title}` } });

test("the tab shows the issue's head, its title and headline whole with its status, id, kind, pull request and agent, then the detail read from the plugin: its description, Done when and record, each verdict's failures open", async () => {
  const title = "Retry failed webhook deliveries with exponential backoff, capped at five attempts, and record each one";
  const pr: PrSnapshot = { number: 41, url: "https://github.com/acme/notes/pull/41", state: "open", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] };
  const { view, opened: read, tab } = await opened("WEB-1", [issue("WEB-1", { title, status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a1"), pr }), issue("WEB-2", {})]);
  assert.deepEqual(read, [{ coordinatorId: COORDINATOR.id, issueId: "WEB-1" }], "only its own issue is read");

  const head = within(view.getByRole("article").querySelector("header") ?? assert.fail("no head"));
  assert.equal(head.getByRole("heading", { level: 2 }).textContent, title, "its title whole, never faded");
  assert.ok(head.getByRole("img", { name: "In review" }));
  assert.ok(head.getByText("✓ Verified: Retries land"));
  assert.equal(head.getByRole("link", { name: "Pull request 41, open, CI passing" }).getAttribute("href"), pr.url);
  fireEvent.click(head.getByRole("button", { name: "Open a1's thread" }));
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_a1" }]);

  assert.ok(tab().getByText(DETAIL.description));
  assert.deepEqual(
    tab().getAllByRole("listitem").slice(0, 2).map((item) => item.textContent),
    DETAIL.doneCriteria,
  );
  assert.ok(tab().getByText("Done when"));
  assert.ok(tab().getByText("1 of 2 criteria passed"));
  assert.match(tab().getByLabelText("Evidence for criterion 2").textContent ?? "", /1 failing/);
  assert.equal(tab().getByLabelText("Evidence for criterion 2").closest("details")?.open, true);
  assert.equal(tab().getByLabelText("Evidence for criterion 1").closest("details")?.open, false);
  assert.ok(tab().getByText(/on the agent's own model/));
  assert.deepEqual(headings(tab()), ["Done when", "Record"], "no relations or decisions, no section for them");
});

test("the tab changes as the board does: a read that moves its issue on shows its new status and headline", async () => {
  const { view, reread } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress", headline: "Working", agent: agent("a1") })]);
  await reread([issue("WEB-1", { status: "verifying", headline: "Verifying: Retries land with backoff", agent: agent("a1") })]);
  const head = within(view.getByRole("article").querySelector("header") ?? assert.fail("no head"));
  await head.findByRole("img", { name: "Verifying" });
  assert.ok(head.getByText("Verifying: Retries land with backoff"));
});

test("a tab whose params name no issue asks for one from the Board, and one whose issue this manager doesn't have says so", async () => {
  const stale = await mount(null, [issue("WEB-1", {})]);
  assert.ok(await stale.view.findByText("Open an issue from its row on the Board."));
  assert.equal(stale.view.queryByRole("article"), null);
  cleanup();

  const elsewhere = await mount({ issueId: "WEB-9" }, [issue("WEB-1", {})]);
  assert.ok(await elsewhere.view.findByText("This regional manager has no issue WEB-9."));
});

test("the tab lists its decisions oldest first: each question put to the user with their answer or still waiting, and each the regional manager recorded", async () => {
  const decisions: IssueDetail["decisions"] = [
    { kind: "asked", id: decisionIdSchema.parse("d3"), question: "Ship behind a flag?", at: 1_000, answer: { text: "Yes, off by default", at: 1_500 } },
    { kind: "recorded", text: "Retries cap at 5: the user's answer to d3 keeps the flag off.", at: 2_000 },
    { kind: "asked", id: decisionIdSchema.parse("d4"), question: "Backfill old deliveries?", at: 3_000, answer: null },
  ];
  const { tab } = await opened("WEB-1", [issue("WEB-1", {})], () => ({ ...DETAIL, decisions }));
  const part = within(tab().getByRole("heading", { name: "Decisions" }).closest("section") ?? assert.fail("a Decisions part"));

  const entries = part.getAllByRole("listitem").map((item) => item.textContent ?? "");
  assert.equal(entries.length, 3);
  assert.match(entries[0] ?? "", /^d3Ship behind a flag\?You answered: Yes, off by default/);
  assert.match(entries[1] ?? "", /^Retries cap at 5: .*Recorded by the regional manager/);
  assert.match(entries[2] ?? "", /^d4Backfill old deliveries\?Waiting for your answer/);
});

test("a build parent's tab shows its final checks, oldest first and the latest open, each on its default branch with the verdict's criteria, evidence, findings and verifier", async () => {
  const MERGED = "b".repeat(40);
  const failed: ShownVerdict = {
    state: "returned", at: 5_000,
    verifierThreadId: "thr_final_1",
    headSha: MERGED,
    checkout: { headSha: MERGED, changedFiles: ["?? scratch.txt"], changedFileCount: 1 },
    criteria: [{ criterion: "npm run vault-suite passes", result: "fail", evidence: "not ok 4 - tokens survive a restart" }],
    findings: ["The vault client logs card numbers"],
    sameModel: false,
    settlement: { kind: "checked", ci: { kind: "none" } },
  };
  const parent: IssueDetail = {
    ...DETAIL,
    doneCriteria: ["npm run vault-suite passes"],
    record: [],
    finalChecks: [
      { at: 4_000, defaultBranch: "main", verdict: failed },
      { at: 5_000, defaultBranch: "main", verdict: { state: "running", verifierThreadId: "thr_final_2" } },
    ],
  };
  const { tab } = await opened("WEB-1", [issue("WEB-1", { status: "verifying", headline: "Final check running", subIssues: { done: 2, total: 2 } })], () => parent);
  const checks = tab().getAllByRole("group").filter((group) => group.parentElement?.parentElement?.classList.contains("rmi-final-checks"));
  assert.deepEqual(
    checks.map((check) => [check.querySelector("summary")?.textContent, check.hasAttribute("open")]),
    [
      [`Failedon main${shortTime(4_000)}`, false],
      [`Runningon main${shortTime(5_000)}`, true],
    ],
  );
  assert.ok(within(checks[1] ?? assert.fail("no running check")).getByRole("button", { name: "Open Verifier's thread" }), "the running one links its verifier");
  fireEvent.click(checks[0]?.querySelector("summary") ?? assert.fail("no summary"));
  assert.ok(tab().getByText("0 of 1 criterion passed"));
  assert.match(tab().getByText(/^On main at/).textContent ?? "", /^On main at bbbbbbb$/);
  assert.match(tab().getByText(/^Not a clean tree\./).textContent ?? "", /the working tree had 1 changed file: \?\? scratch\.txt/);
  assert.match(tab().getByLabelText("Evidence for criterion 1").textContent ?? "", /tokens survive a restart/);
  assert.ok(tab().getByText("The vault client logs card numbers"));
});

test("a check whose verifier asks or stalled gives the reason in its tab and links the verifier's thread", async () => {
  const reason = "its verifier showed no activity for 30 minutes";
  const withVerdict = (verdict: ShownVerdict): IssueDetail => ({ ...DETAIL, record: DETAIL.record.map((held) => ({ ...held, handoffs: held.handoffs.map((handoff) => ({ ...handoff, verdict })) })) });

  const asking = await opened("WEB-1", [issue("WEB-1", { status: "verifying", agent: agent("a1") })], () => withVerdict({ state: "running", verifierThreadId: "thr_asking" }));
  assert.ok(asking.tab().getByText("Being verified"));
  fireEvent.click(asking.tab().getByRole("button", { name: "Open Verifier's thread" }));
  assert.deepEqual(asking.view.navigateCalls, [{ method: "toThread", threadId: "thr_asking" }]);
  cleanup();

  const stalled = await opened("WEB-2", [issue("WEB-2", { status: "in-progress", agent: agent("a2") })], () => withVerdict({ state: "could-not-run", at: 5_000, verifierThreadId: "thr_stalled", reason }));
  assert.ok(stalled.tab().getByText(`No verdict: ${reason}`));
  fireEvent.click(stalled.tab().getByRole("button", { name: "Open Verifier's thread" }));
  assert.deepEqual(stalled.view.navigateCalls, [{ method: "toThread", threadId: "thr_stalled" }]);
});

test("a research issue's tab shows its Questions and its report as Markdown, with the file it is saved in and no verdict", async () => {
  const { tab } = await opened("WEB-2", [issue("WEB-2", { kind: "research", status: "done", headline: "Handed off: Vault fits our PCI scope", agent: agent("a2") })], () => researched(["Which one fits our PCI scope, and why?"]));
  assert.ok(tab().getByText("Questions"));
  assert.equal(tab().queryByText("Done when"), null);
  const report = tab().getByRole("region", { name: "Report reports/WEB-2.md" });
  assert.equal(report.tabIndex, 0, "the keyboard reaches the report to scroll it");
  // why its source: the SDK's test kit stands in for bb's Markdown with the text it is given; bb renders it.
  assert.equal(within(report).getByTestId("bb-markdown").textContent, REPORT, "the report goes whole to bb's Markdown");
  assert.equal(tab().queryByText(/criteri(on|a) passed|Waiting for a verifier|Being verified|Not verified/), null);
  assert.equal(tab().queryByRole("button", { name: /Verifier/ }), null);
});

test("a research issue asked no questions shows no Questions section", async () => {
  const { tab } = await opened("WEB-2", [issue("WEB-2", { kind: "research", status: "in-progress", headline: "Working", agent: agent("a2") })], () => researched([]));
  assert.equal(tab().queryByText("Questions"), null);
  assert.ok(tab().getByRole("region", { name: "Report reports/WEB-2.md" }));
});

test("the tab lists what its issue depends on and what it blocks, each by its status, id and title; pressing one opens that issue's tab", async () => {
  const relations: Record<string, Pick<IssueDetail, "dependsOn" | "blocks">> = { "WEB-2": { dependsOn: [id("WEB-1")], blocks: [id("WEB-3")] } };
  const { view, tab } = await opened(
    "WEB-2",
    [
      issue("WEB-1", { kind: "research", status: "done", title: "Pick a card vault", headline: "Handed off: Vault" }),
      issue("WEB-2", { title: "Card vault" }),
      issue("WEB-3", { title: "Vault schema", blockedBy: [id("WEB-2")] }),
    ],
    (issueId) => ({ ...DETAIL, ...relations[issueId] }),
  );
  assert.deepEqual(section(tab(), "Depends on"), ["WEB-1: Pick a card vault, Done"]);
  assert.deepEqual(section(tab(), "Blocks"), ["WEB-3: Vault schema, Todo"]);

  fireEvent.click(tab().getByRole("button", { name: "WEB-1: Pick a card vault, Done" }));
  fireEvent.click(tab().getByRole("button", { name: "WEB-3: Vault schema, Todo" }));
  assert.deepEqual(view.experimental_panelCalls, [issueTabCall("WEB-1", "Pick a card vault"), issueTabCall("WEB-3", "Vault schema")]);
});

test("a relation to an issue the board hasn't read yet shows its id alone, nothing to press, and the board's next read makes it the issue's entry, opening its tab", async () => {
  const pickVault = issue("WEB-1", { kind: "research", title: "Pick a card vault", headline: "Researching" });
  const { view, tab, reread } = await opened("WEB-1", [pickVault], () => ({ ...DETAIL, blocks: [id("WEB-2")] }));
  const blocks = () => within(tab().getByRole("heading", { name: "Blocks" }).closest("section") ?? assert.fail("no Blocks section"));
  assert.deepEqual(blocks().getAllByRole("listitem").map((entry) => entry.textContent), ["WEB-2"], "filed since the board's read, it is listed by its id");
  assert.equal(blocks().queryByRole("button"), null, "with no row to go to, nothing to press");

  await reread([pickVault, issue("WEB-2", { title: "Card vault", blockedBy: [id("WEB-1")] })]);
  fireEvent.click(await blocks().findByRole("button", { name: "WEB-2: Card vault, Todo" }));
  assert.deepEqual(view.experimental_panelCalls, [issueTabCall("WEB-2", "Card vault")]);
});

test("a sub-issue's tab lists as inherited only what its parent's row is blocked by, so a dependency removed since the board's read never reads as inherited", async () => {
  // The board read each row before WEB-4 and WEB-3 dropped their dependency on WEB-5; their details read after.
  const board = [
    issue("WEB-9", { kind: "research", title: "Pick a vault", headline: "Researching" }),
    issue("WEB-5", { title: "Audit log" }),
    issue("WEB-4", { title: "Retry queue", blockedBy: [id("WEB-5")] }),
    issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 0, total: 1 }, blockedBy: [id("WEB-9")], headline: null }),
    issue("WEB-3", { title: "Webhook", parentId: id("WEB-1"), status: "in-progress", blockedBy: [id("WEB-9"), id("WEB-5")] }),
  ];
  const topLevel = await opened("WEB-4", board);
  assert.equal(topLevel.tab().queryByRole("heading", { name: "Depends on" }), null, "a top-level issue has no parent to inherit from");
  cleanup();

  const sub = await opened("WEB-3", board);
  assert.deepEqual(section(sub.tab(), "Depends on"), ["WEB-9: Pick a vault, Todo, through WEB-1"], "only what WEB-1 depends on, not WEB-5, which WEB-1 never did");
});

test("a parent's tab lists its sub-issues and a sub-issue's names its parent, each opening the other's tab; a parent's dependency blocks its sub-issue through it", async () => {
  const relations: Record<string, Pick<IssueDetail, "dependsOn" | "blocks">> = { "WEB-1": { dependsOn: [id("WEB-9")], blocks: [] } };
  const board = [
    issue("WEB-9", { kind: "research", status: "backlog", title: "Pick a vault", headline: "Not planned" }),
    issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 0, total: 2 }, blockedBy: [id("WEB-9")], headline: null }),
    issue("WEB-2", { title: "Vault schema", parentId: id("WEB-1"), blockedBy: [id("WEB-9")] }),
    issue("WEB-3", { title: "Webhook", parentId: id("WEB-1"), status: "in-progress", needsYou: "Blocked: Needs a staging key", headline: "Blocked: Needs a staging key", blockedBy: [id("WEB-9")], agent: agent("a3") }),
  ];
  const parent = await opened("WEB-1", board, (issueId) => ({ ...DETAIL, ...relations[issueId] }));
  assert.deepEqual(headings(parent.tab()), ["Sub-issues", "Depends on", "Done when", "Record"]);
  assert.deepEqual(section(parent.tab(), "Sub-issues"), ["WEB-2: Vault schema, Todo", "WEB-3: Webhook, In progress"]);
  assert.deepEqual(section(parent.tab(), "Depends on"), ["WEB-9: Pick a vault, Backlog"]);
  fireEvent.click(parent.tab().getByRole("button", { name: "WEB-3: Webhook, In progress" }));
  assert.deepEqual(parent.view.experimental_panelCalls, [issueTabCall("WEB-3", "Webhook")]);
  cleanup();

  const sub = await opened("WEB-3", board, (issueId) => ({ ...DETAIL, ...relations[issueId] }));
  assert.deepEqual(headings(sub.tab()), ["Parent", "Depends on", "Done when", "Record"]);
  assert.deepEqual(section(sub.tab(), "Parent"), ["WEB-1: Card vault, In progress"]);
  assert.deepEqual(section(sub.tab(), "Depends on"), ["WEB-9: Pick a vault, Backlog, through WEB-1"], "every blocker its row names, its parent's too");
  fireEvent.click(sub.tab().getByRole("button", { name: "WEB-1: Card vault, In progress" }));
  assert.deepEqual(sub.view.experimental_panelCalls, [issueTabCall("WEB-1", "Card vault")]);
});

test("the tab is offered only in a regional manager's thread, where its board is", async () => {
  const visible = (threadId: string) => {
    let shown: boolean | null = null;
    const Probe = () => {
      shown = issueTab.useVisible({ threadId });
      return null;
    };
    renderSlot({ component: Probe }, {}, { experimental_rpcContract: coordinatorContract, rpc: { coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }) } });
    return () => shown;
  };
  const manager = visible(COORDINATOR.threadId);
  const other = visible("thr_other");
  await waitFor(() => assert.equal(manager(), true));
  assert.equal(other(), false);
});
