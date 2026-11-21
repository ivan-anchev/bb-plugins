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
import { memoryFileSchema } from "../../model/memory-file.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../model/role.ts";
import type { ShownVerdict } from "../../model/verdict/verdict.ts";
import { shortTime } from "../ui/time.ts";

// The board as bb mounts it, reading the plugin: its lanes from the board's read, and an issue's
// detail from the `issue` read, made only when its row opens.

// why: the board brings its stylesheet, which bb's build bundles and node can't load.
registerHooks({ load: (url, context, nextLoad) => (url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context)) });
// why: jsdom has none of these; the rows measure their titles, the working ring and going to an issue
// ask for Reduce motion (on unless a test turns it off), and the ring for a canvas. Going to an issue
// scrolls its row, which jsdom doesn't do: each scroll asked for is recorded in `scrolls`. jsdom lays
// nothing out, so `resized` stands in for the browser telling every observer a size changed;
// `observing` holds each observer connected, with the element it observes.
let reduceMotion = true;
const observing = new Map<() => void, Element>();
const resized = () => act(() => [...observing.keys()].forEach((changed) => changed()));
Object.assign(globalThis, {
  ResizeObserver: class {
    // why no entries: the board's observers only re-measure, reading no entry.
    readonly #changed: () => void;
    constructor(changed: () => void) {
      this.#changed = changed;
    }
    observe(target: Element) {
      observing.set(this.#changed, target);
    }
    disconnect() {
      observing.delete(this.#changed);
    }
  },
  matchMedia: () => ({ get matches() { return reduceMotion; }, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;
const scrolls: { label: string | null; options: ScrollIntoViewOptions | boolean | undefined }[] = [];
Element.prototype.scrollIntoView = function (this: Element, options) {
  scrolls.push({ label: this.getAttribute("aria-label"), options });
};

const { Board } = await import("./board.tsx");

const COORDINATOR = coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10");
const SHA = "4b1d9e0c2a7f3e5d6c8b9a0f1e2d3c4b5a697881";

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
const id = (raw: string) => issueIdSchema.parse(raw);
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
  finalChecks: [],
};

const REPORT = "## Recommendation\n\nVault: it keeps card data **inside** our PCI scope.";

/** A research issue opened on the board, asked `questions`, whose agent handed off a report. */
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
          report: { report: REPORT, file: memoryFileSchema.parse("reports/i2.md") },
          verdict: null,
        },
      ],
    },
  ],
  finalChecks: [],
});

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
async function mount(data: Read, answer: (input: unknown) => void = () => {}, detailOf: (issueId: string) => IssueDetail = () => DETAIL) {
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
        return detailOf(coordinatorContract.issue.input.parse(input).issueId);
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
  const detail = within(view.getByRole("region", { name: "i1" }));
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
  assert.equal(detail.queryByRole("heading", { name: /^(Depends on|Blocks)$/ }), null, "no relations, no section for them");

  fireEvent.click(row);
  assert.equal(view.queryByRole("region", { name: "i1" }), null);
});

test("a build parent opens to its final checks, oldest first and the latest open, each on its default branch with the verdict's criteria, evidence, findings and verifier", async () => {
  const MERGED = "b".repeat(40);
  const failed: ShownVerdict = {
    state: "returned",
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
  const { view } = await mount({ decisions: [], issues: [issue("i1", { status: "verifying", headline: "Final check running", subIssues: { done: 2, total: 2 } })] }, () => {}, () => parent);
  fireEvent.click(view.getByRole("button", { name: /\bi1 Build/ }));
  const detail = within(view.getByRole("region", { name: "i1" }));
  await detail.findByText("Final checks");
  const checks = detail.getAllByRole("group").filter((group) => group.parentElement?.parentElement?.classList.contains("rmi-final-checks"));
  assert.deepEqual(
    checks.map((check) => [check.querySelector("summary")?.textContent, check.hasAttribute("open")]),
    [
      [`Failedon main${shortTime(4_000)}`, false],
      [`Runningon main${shortTime(5_000)}`, true],
    ],
  );
  assert.ok(within(checks[1] ?? assert.fail("no running check")).getByRole("button", { name: "Open Verifier's thread" }), "the running one links its verifier");
  fireEvent.click(checks[0]?.querySelector("summary") ?? assert.fail("no summary"));
  assert.ok(detail.getByText("0 of 1 criterion passed"));
  assert.match(detail.getByText(/^On main at/).textContent ?? "", /^On main at bbbbbbb$/);
  assert.match(detail.getByText(/^Not a clean tree\./).textContent ?? "", /the working tree had 1 changed file: \?\? scratch\.txt/);
  assert.match(detail.getByLabelText("Evidence for criterion 1").textContent ?? "", /tokens survive a restart/);
  assert.ok(detail.getByText("The vault client logs card numbers"));
});

test("a check whose verifier asks or stalled reads why on its row, and its opened issue gives the reason and links the verifier's thread", async () => {
  const asking = "Verifying, its verifier asking for an answer or an approval, which the plugin declines: Retries land with backoff";
  const stalled = "Couldn't verify, as its verifier showed no activity for 30 minutes: Retries land with backoff";
  const reason = "its verifier showed no activity for 30 minutes";
  const withVerdict = (verdict: ShownVerdict): IssueDetail => ({ ...DETAIL, record: DETAIL.record.map((held) => ({ ...held, handoffs: held.handoffs.map((handoff) => ({ ...handoff, verdict })) })) });
  const verdicts: Record<string, ShownVerdict> = {
    i1: { state: "running", verifierThreadId: "thr_asking" },
    i2: { state: "could-not-run", verifierThreadId: "thr_stalled", reason },
  };
  const { view } = await mount(
    {
      decisions: [],
      issues: [issue("i1", { status: "verifying", headline: asking, agent: agent("a1") }), issue("i2", { status: "in-progress", needsYou: stalled, headline: stalled, agent: agent("a2") })],
    },
    () => {},
    (issueId) => withVerdict(verdicts[issueId] ?? assert.fail(`no verdict for ${issueId}`)),
  );
  assert.ok(view.getByRole("button", { name: new RegExp(`\\bi1 Build.*${asking}`) }));
  assert.ok(view.getByRole("button", { name: new RegExp(`\\bi2 Build.*${stalled.replace(/[()]/g, "\\$&")}`) }));

  fireEvent.click(view.getByRole("button", { name: /\bi1 Build/ }));
  const askingDetail = within(view.getByRole("region", { name: "i1" }));
  await askingDetail.findByText("Being verified");
  fireEvent.click(askingDetail.getByRole("button", { name: "Open Verifier's thread" }));

  fireEvent.click(view.getByRole("button", { name: /\bi2 Build/ }));
  const stalledDetail = within(view.getByRole("region", { name: "i2" }));
  await stalledDetail.findByText(`No verdict: ${reason}`);
  fireEvent.click(stalledDetail.getByRole("button", { name: "Open Verifier's thread" }));
  assert.deepEqual(view.navigateCalls, [
    { method: "toThread", threadId: "thr_asking" },
    { method: "toThread", threadId: "thr_stalled" },
  ]);
});

test("a research row reads Research with no pull request, and opens to its Questions and its report as Markdown, with the file it is saved in and no verdict", async () => {
  const research = issue("i2", { kind: "research", status: "done", headline: "Handed off: Vault fits our PCI scope", agent: agent("a2") });
  const { view } = await mount({ decisions: [], issues: [research] }, undefined, () => researched(["Which one fits our PCI scope, and why?"]));
  fireEvent.click(view.getByRole("button", { name: /^Done/ }));
  const row = view.getByRole("button", { name: /\bi2 Research: Title of i2/ });
  assert.equal(view.queryByRole("link", { name: /^Pull request/ }), null);

  fireEvent.click(row);
  const detail = within(view.getByRole("region", { name: "i2" }));
  await detail.findByText("Questions");
  assert.equal(detail.queryByText("Done when"), null);
  const report = detail.getByRole("region", { name: "Report reports/i2.md" });
  assert.equal(report.tabIndex, 0, "the keyboard reaches the report to scroll it");
  // why its source: the SDK's test kit stands in for bb's Markdown with the text it is given; bb renders it.
  assert.equal(within(report).getByTestId("bb-markdown").textContent, REPORT, "the report goes whole to bb's Markdown");
  assert.equal(detail.queryByText(/criteri(on|a) passed|Waiting for a verifier|Being verified|Not verified/), null);
  assert.equal(detail.queryByRole("button", { name: /Verifier/ }), null);
});

test("a research issue asked no questions opens to no Questions section", async () => {
  const research = issue("i2", { kind: "research", status: "in-progress", headline: "Working", agent: agent("a2") });
  const { view } = await mount({ decisions: [], issues: [research] }, undefined, () => researched([]));
  fireEvent.click(view.getByRole("button", { name: /\bi2 Research/ }));
  const detail = within(view.getByRole("region", { name: "i2" }));
  await detail.findByText("Which vault fits our PCI scope.");
  assert.equal(detail.queryByText("Questions"), null);
  assert.ok(detail.getByRole("region", { name: "Report reports/i2.md" }));
});

test("an opened issue lists what it depends on and what it blocks, each by its status, id and title; pressing one unfolds its lane, opens its row, moves focus there and scrolls it to the top", async () => {
  const relations: Record<string, Pick<IssueDetail, "dependsOn" | "blocks">> = { i1: { dependsOn: [], blocks: [id("i2")] }, i2: { dependsOn: [id("i1")], blocks: [id("i3")] }, i3: { dependsOn: [id("i2")], blocks: [] } };
  const { view } = await mount(
    {
      decisions: [],
      issues: [
        issue("i1", { kind: "research", status: "done", title: "Pick a card vault", headline: "Handed off: Vault" }),
        issue("i2", { title: "Card vault" }),
        issue("i3", { title: "Vault schema", blockedBy: [id("i2")] }),
      ],
    },
    undefined,
    (issueId) => ({ ...DETAIL, ...relations[issueId] }),
  );
  fireEvent.click(view.getByRole("button", { name: /\bi2 Build/ }));
  const detail = within(view.getByRole("region", { name: "i2" }));
  await detail.findByText(DETAIL.description);
  const listed = (name: string) => within(detail.getByRole("heading", { name }).closest("section") ?? assert.fail(`no ${name}`)).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  assert.deepEqual(listed("Depends on"), ["i1: Pick a card vault, Done"]);
  assert.deepEqual(listed("Blocks"), ["i3: Vault schema, Todo"]);
  assert.equal(view.getByRole("button", { name: /^Done/ }).getAttribute("aria-expanded"), "false", "i1's lane starts folded");

  scrolls.length = 0;
  fireEvent.click(detail.getByRole("button", { name: "i1: Pick a card vault, Done" }));
  assert.equal(view.getByRole("button", { name: /^Done/ }).getAttribute("aria-expanded"), "true", "its lane unfolds");
  const research = view.getByRole("button", { name: /\bi1 Research/ });
  assert.equal(research.getAttribute("aria-expanded"), "true", "its row opens");
  assert.ok(document.activeElement === research, "focus is on its row");
  assert.deepEqual(scrolls, [{ label: research.getAttribute("aria-label"), options: { block: "start", behavior: "instant" } }], "its row goes to the top of the page, its detail under it, at once under Reduce motion");
  const opened = within(view.getByRole("region", { name: "i1" }));
  await opened.findByRole("heading", { name: "Blocks" });
  assert.equal(opened.queryByRole("heading", { name: "Depends on" }), null, "it depends on nothing");
  resized();
  assert.equal(scrolls.length, 2, "kept at the top as its detail draws, which the page may not have reached far enough for");
  fireEvent.wheel(document);
  resized();
  assert.equal(scrolls.length, 2, "and let go once the user scrolls");

  reduceMotion = false;
  scrolls.length = 0;
  fireEvent.click(opened.getByRole("button", { name: "i2: Card vault, Todo" }));
  reduceMotion = true;
  assert.deepEqual(scrolls, [{ label: view.getByRole("button", { name: /\bi2 Build/ }).getAttribute("aria-label"), options: { block: "start", behavior: "smooth" } }], "smoothly otherwise");
  assert.ok(document.activeElement === view.getByRole("button", { name: /\bi2 Build/ }));
});

test("a relation to an issue the board hasn't read yet shows its id alone, nothing to press, and the board's next read makes it the issue's entry, going to it", async () => {
  const pickVault = issue("i1", { kind: "research", title: "Pick a card vault", headline: "Researching" });
  const { view, reread } = await mount({ decisions: [], issues: [pickVault] }, undefined, (issueId) => ({ ...DETAIL, blocks: issueId === "i1" ? [id("i2")] : [] }));
  fireEvent.click(view.getByRole("button", { name: /\bi1 Research/ }));
  const detail = within(view.getByRole("region", { name: "i1" }));
  await detail.findByText(DETAIL.description);
  const blocks = () => within(detail.queryByRole("heading", { name: "Blocks" })?.closest("section") ?? assert.fail("no Blocks section"));
  assert.deepEqual(blocks().getAllByRole("listitem").map((entry) => entry.textContent), ["i2"], "filed since the board's read, it is listed by its id");
  assert.equal(blocks().queryByRole("button"), null, "with no row to go to, nothing to press");

  await reread({ decisions: [], issues: [pickVault, issue("i2", { title: "Card vault", blockedBy: [id("i1")] })] });
  fireEvent.click(blocks().getByRole("button", { name: "i2: Card vault, Todo" }));
  const card = view.getByRole("button", { name: /\bi2 Build/ });
  assert.ok(document.activeElement === card && card.getAttribute("aria-expanded") === "true", "once read, it goes to i2's row");
});

test("a detail lists as its parent's only what the parent's row is blocked by, so a dependency removed since the board's read never reads as inherited", async () => {
  // The board read each row before i4 and i3 dropped their dependency on i5; their details read after.
  const { view } = await mount(
    {
      decisions: [],
      issues: [
        issue("i9", { kind: "research", title: "Pick a vault", headline: "Researching" }),
        issue("i5", { title: "Audit log" }),
        issue("i4", { title: "Retry queue", blockedBy: [id("i5")] }),
        issue("i1", { title: "Card vault", status: "in-progress", subIssues: { done: 0, total: 1 }, blockedBy: [id("i9")], headline: null }),
        issue("i3", { title: "Webhook", parentId: id("i1"), status: "in-progress", blockedBy: [id("i9"), id("i5")] }),
      ],
    },
    undefined,
    () => DETAIL,
  );
  const dependsOn = (detail: ReturnType<typeof within>) => {
    const heading = detail.queryByRole("heading", { name: "Depends on" });
    return heading === null ? [] : within(heading.closest("section") ?? assert.fail("no section")).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  };

  fireEvent.click(view.getByRole("button", { name: /\bi4 Build/ }));
  const topLevel = within(view.getByRole("region", { name: "i4" }));
  await topLevel.findByText(DETAIL.description);
  assert.deepEqual(dependsOn(topLevel), [], "a top-level issue has no parent to inherit from");

  fireEvent.click(view.getByRole("button", { name: /\bi3 Build/ }));
  const sub = within(view.getByRole("region", { name: "i3" }));
  await sub.findByText(DETAIL.description);
  assert.deepEqual(dependsOn(sub), ["i9: Pick a vault, Todo, through i1"], "only what i1 depends on, not i5, which i1 never did");
});

test("an issue gone to lets go of the page once a read moves its row to another lane or off the board, with no move of the user's", async () => {
  const board = (i1: Partial<IssueRow> | null): Read => ({
    decisions: [],
    issues: [...(i1 === null ? [] : [issue("i1", { status: "done", title: "Pick a card vault", ...i1 })]), issue("i2", { title: "Card vault" })],
  });
  const { view, reread } = await mount(board({}), undefined, (issueId) => ({ ...DETAIL, dependsOn: issueId === "i2" ? [id("i1")] : [] }));
  const watchingGone = () => [...observing.values()].filter((element) => !element.isConnected);
  const goToI1 = async () => {
    const detail = within(view.getByRole("region", { name: "i2" }));
    fireEvent.click(await detail.findByRole("button", { name: /^i1: Pick a card vault/ }));
    scrolls.length = 0;
    resized();
    assert.equal(scrolls.length, 1, "held at the top as it draws");
  };
  fireEvent.click(view.getByRole("button", { name: /\bi2 Build/ }));

  await goToI1();
  await reread(board({ status: "in-progress" }));
  scrolls.length = 0;
  resized();
  assert.deepEqual([scrolls, watchingGone()], [[], []], "moved to In progress, the row it held is gone, and nothing watches it");

  await goToI1();
  await reread(board(null));
  scrolls.length = 0;
  resized();
  assert.deepEqual([scrolls, watchingGone()], [[], []], "gone from the board, nothing watches its row");
});

test("a detail leaves the nesting to the rows: a parent lists no sub-issues and a sub-issue under it no parent; the flat copy under Needs you names its Parent and goes there; a parent's dependency blocks its sub-issue through it", async () => {
  const relations: Record<string, Pick<IssueDetail, "dependsOn" | "blocks">> = { i1: { dependsOn: [id("i9")], blocks: [] }, i9: { dependsOn: [], blocks: [id("i1")] } };
  const { view } = await mount(
    {
      decisions: [],
      issues: [
        issue("i9", { kind: "research", status: "backlog", title: "Pick a vault", headline: "Not planned" }),
        issue("i1", { title: "Card vault", status: "in-progress", subIssues: { done: 0, total: 2 }, blockedBy: [id("i9")], headline: null }),
        issue("i2", { title: "Vault schema", parentId: id("i1"), blockedBy: [id("i9")] }),
        issue("i3", { title: "Webhook", parentId: id("i1"), status: "in-progress", needsYou: BLOCKED, headline: BLOCKED, blockedBy: [id("i9")], agent: agent("a3") }),
      ],
    },
    undefined,
    (issueId) => ({ ...DETAIL, ...relations[issueId] }),
  );
  const section = (detail: ReturnType<typeof within>, name: string) =>
    within(detail.getByRole("heading", { name }).closest("section") ?? assert.fail(`no ${name}`)).getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  const headings = (detail: ReturnType<typeof within>) => detail.getAllByRole("heading", { level: 3 }).map((heading: HTMLElement) => heading.textContent);

  fireEvent.click(view.getByRole("button", { name: /\bi1 Build/ }));
  const parent = within(view.getByRole("region", { name: "i1" }));
  await parent.findByText(DETAIL.description);
  assert.deepEqual(headings(parent), ["Depends on", "Done when", "Record"], "its sub-issues' rows sit right under it");
  assert.deepEqual(section(parent, "Depends on"), ["i9: Pick a vault, Backlog"]);

  const working = within(view.getByRole("region", { name: /^In progress/ }));
  fireEvent.click(working.getByRole("button", { name: /\bi3 Build/ }));
  const nested = within(view.getByRole("region", { name: "i3" }));
  await nested.findByText(DETAIL.description);
  assert.deepEqual(headings(nested), ["Depends on", "Done when", "Record"], "its row sits under its parent's");
  assert.deepEqual(section(nested, "Depends on"), ["i9: Pick a vault, Backlog, through i1"], "every blocker its row names, its parent's too");
  fireEvent.click(working.getByRole("button", { name: /\bi3 Build/ }));

  fireEvent.click(within(view.getByRole("region", { name: /^Needs you/ })).getByRole("button", { name: /\bi3 Build/ }));
  const flat = within(view.getByRole("region", { name: "i3" }));
  await flat.findByText(DETAIL.description);
  assert.deepEqual(headings(flat), ["Parent", "Depends on", "Done when", "Record"]);
  assert.deepEqual(section(flat, "Parent"), ["i1: Card vault, In progress"]);

  fireEvent.click(flat.getByRole("button", { name: "i1: Card vault, In progress" }));
  const parentRow = view.getByRole("button", { name: /\bi1 Build/ });
  assert.ok(document.activeElement === parentRow && parentRow.getAttribute("aria-expanded") === "true", "the parent's row opens and takes focus");

  fireEvent.click(flat.getByRole("button", { name: "i9: Pick a vault, Backlog, through i1" }));
  assert.equal(view.getByRole("button", { name: /^Backlog/ }).getAttribute("aria-expanded"), "true");
  assert.ok(document.activeElement === view.getByRole("button", { name: /\bi9 Research/ }));
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

test("an answer sent from the answer's own field hands focus to Done's header while Done is folded, and to the answered row while it is open", async () => {
  for (const unfold of [false, true]) {
    const { view, reread } = await mount({ decisions: [decision("d1", false)], issues: [issue("i1", { status: "done", headline: "Merged #9" })] });
    if (unfold) fireEvent.click(view.getByRole("button", { name: /^Done/ }));
    type(view, "Yes");
    const send = view.getByRole("button", { name: "Send" });
    send.focus();
    await act(async () => fireEvent.click(send));
    await reread({ decisions: [decision("d1", true)], issues: [issue("i1", { status: "done", headline: "Merged #9" })] });

    const done = view.getByRole("button", { name: /^Done/ });
    const landed = unfold ? done.closest("section")?.querySelector("li [tabindex='-1']") : done;
    assert.ok(landed !== null && landed !== undefined && document.activeElement === landed, unfold ? "on the answered row" : "on Done's header");
    cleanup();
  }
});
