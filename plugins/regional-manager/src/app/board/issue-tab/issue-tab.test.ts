import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { coordinatorContract, type IssueFeed } from "../../../contract.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import { agent, COORDINATOR, FEED, headings, id, issue, issueTab, mount, opened, SHA } from "./test-tab.ts";

// An issue's own tab: its head from the board's row, then what its feed read adds, its description and
// relations; the feed itself is feed/feed.test.ts's.

afterEach(cleanup);

const section = (tab: ReturnType<typeof within>, name: string) =>
  within(tab.getByRole("heading", { name }).closest("section") ?? assert.fail(`no ${name}`)).getAllByRole("button").map((button) => button.getAttribute("aria-label"));

/** The issue tab bb is asked to open, as the side panel's `openTab` gets it. */
const issueTabCall = (raw: string, title: string) => ({ method: "openTab", options: { tab: { id: "issue", context: { kind: "thread" }, availability: "action" }, params: { issueId: raw }, title: `${raw} ${title}` } });

const related = (relations: Record<string, Pick<IssueFeed, "dependsOn" | "blocks">>) => (issueId: string) => ({ ...FEED, ...relations[issueId] });

test("the tab shows the issue's head, its title and headline whole with its id and kind, its status, pull request and agents, then its own feed: its description, Done when and Activity", async () => {
  const title = "Retry failed webhook deliveries with exponential backoff, capped at five attempts, and record each one";
  const pr: PrSnapshot = { forge: "github", number: 41, url: "https://github.com/acme/notes/pull/41", state: "open", draft: false, review: "none", ci: "pass", headSha: SHA, failedChecks: [] };
  const { view, feedReads, tab } = await opened("WEB-1", [issue("WEB-1", { title, status: "in-review", headline: "✓ Verified: Retries land", agent: agent("a1"), pr }), issue("WEB-2", {})]);
  assert.deepEqual(feedReads, [{ coordinatorId: COORDINATOR.id, issueId: "WEB-1" }], "only its own issue is read");

  const head = within(tab().getByRole("banner"));
  assert.equal(head.getByRole("heading", { level: 2 }).textContent, title, "its title whole, never faded");
  assert.ok(head.getByRole("img", { name: "In review" }));
  assert.ok(head.getByText("✓ Verified: Retries land"));
  assert.equal(head.getByRole("link", { name: "Pull request 41, open, CI passing" }).getAttribute("href"), pr.url);
  fireEvent.click(head.getByRole("button", { name: "a2, Claude Code, not working. Open its thread" }));
  assert.deepEqual(view.navigateCalls, [{ method: "toThread", threadId: "thr_a2" }]);
  assert.equal(tab().getByRole("banner").querySelector(".rmi-thread-link"), null, "no link to the latest agent: its chip opens it");

  assert.ok(tab().getByText(FEED.description));
  assert.deepEqual(headings(tab()), ["Done when", "Activity"], "no relations, no section for them");
});

test("the tab changes as the board does: a read that moves its issue on shows its new status and headline", async () => {
  const { tab, reread } = await opened("WEB-1", [issue("WEB-1", { status: "in-progress", headline: "Working", agent: agent("a1") })]);
  await reread([issue("WEB-1", { status: "verifying", headline: "Verifying: Retries land with backoff", agent: agent("a1") })]);
  const head = within(tab().getByRole("banner"));
  await head.findByRole("img", { name: "Verifying" });
  assert.ok(head.getByText("Verifying: Retries land with backoff"));
});

test("a tab whose params name no issue asks for one from the Board, and one whose issue this manager doesn't have says so", async () => {
  const stale = await mount(null, [issue("WEB-1", {})]);
  assert.ok(await stale.view.findByText("Open an issue from its row on the Board."));
  assert.equal(stale.view.container.querySelector("article"), null);
  cleanup();

  const elsewhere = await mount({ issueId: "WEB-9" }, [issue("WEB-1", {})]);
  assert.ok(await elsewhere.view.findByText("This regional manager has no issue WEB-9."));
});

test("a research issue asked no questions shows no Questions section", async () => {
  const { tab } = await opened("WEB-2", [issue("WEB-2", { kind: "research", status: "in-progress", headline: "Working", agent: agent("a2") })], { feedOf: () => ({ ...FEED, doneCriteria: [] }) });
  assert.equal(tab().queryByText("Questions"), null);
  assert.deepEqual(headings(tab()), ["Activity"]);
});

test("the tab lists what its issue depends on and what it blocks, each by its status, id and title; pressing one opens that issue's tab", async () => {
  const { view, tab } = await opened(
    "WEB-2",
    [
      issue("WEB-1", { kind: "research", status: "done", title: "Pick a card vault", headline: "Handed off: Vault" }),
      issue("WEB-2", { title: "Card vault" }),
      issue("WEB-3", { title: "Vault schema", blockedBy: [id("WEB-2")] }),
    ],
    { feedOf: related({ "WEB-2": { dependsOn: [id("WEB-1")], blocks: [id("WEB-3")] } }) },
  );
  assert.deepEqual(section(tab(), "Depends on"), ["WEB-1: Pick a card vault, Done"]);
  assert.deepEqual(section(tab(), "Blocks"), ["WEB-3: Vault schema, Todo"]);

  fireEvent.click(tab().getByRole("button", { name: "WEB-1: Pick a card vault, Done" }));
  fireEvent.click(tab().getByRole("button", { name: "WEB-3: Vault schema, Todo" }));
  assert.deepEqual(view.experimental_panelCalls, [issueTabCall("WEB-1", "Pick a card vault"), issueTabCall("WEB-3", "Vault schema")]);
});

test("a relation to an issue the board hasn't read yet shows its id alone, nothing to press, and the board's next read makes it the issue's entry, opening its tab", async () => {
  const pickVault = issue("WEB-1", { kind: "research", title: "Pick a card vault", headline: "Researching" });
  const { view, tab, reread } = await opened("WEB-1", [pickVault], { feedOf: () => ({ ...FEED, blocks: [id("WEB-2")] }) });
  const blocks = () => within(tab().getByRole("heading", { name: "Blocks" }).closest("section") ?? assert.fail("no Blocks section"));
  assert.deepEqual(blocks().getAllByRole("listitem").map((entry) => entry.textContent), ["WEB-2"], "filed since the board's read, it is listed by its id");
  assert.equal(blocks().queryByRole("button"), null, "with no row to go to, nothing to press");

  await reread([pickVault, issue("WEB-2", { title: "Card vault", blockedBy: [id("WEB-1")] })]);
  fireEvent.click(await blocks().findByRole("button", { name: "WEB-2: Card vault, Todo" }));
  assert.deepEqual(view.experimental_panelCalls, [issueTabCall("WEB-2", "Card vault")]);
});

test("a sub-issue's tab lists as inherited only what its parent's row is blocked by, so a dependency removed since the board's read never reads as inherited", async () => {
  // The board read each row before WEB-4 and WEB-3 dropped their dependency on WEB-5; their feeds read after.
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
  const feedOf = related({ "WEB-1": { dependsOn: [id("WEB-9")], blocks: [] } });
  const board = [
    issue("WEB-9", { kind: "research", status: "backlog", title: "Pick a vault", headline: "Not planned" }),
    issue("WEB-1", { title: "Card vault", status: "in-progress", subIssues: { done: 0, total: 2 }, blockedBy: [id("WEB-9")], headline: null }),
    issue("WEB-2", { title: "Vault schema", parentId: id("WEB-1"), blockedBy: [id("WEB-9")] }),
    issue("WEB-3", { title: "Webhook", parentId: id("WEB-1"), status: "in-progress", needsYou: "Blocked: Needs a staging key", headline: "Blocked: Needs a staging key", blockedBy: [id("WEB-9")], agent: agent("a3") }),
  ];
  const parent = await opened("WEB-1", board, { feedOf });
  assert.deepEqual(headings(parent.tab()), ["Sub-issues", "Depends on", "Done when", "Activity"]);
  assert.deepEqual(section(parent.tab(), "Sub-issues"), ["WEB-2: Vault schema, Todo", "WEB-3: Webhook, In progress"]);
  assert.deepEqual(section(parent.tab(), "Depends on"), ["WEB-9: Pick a vault, Backlog"]);
  fireEvent.click(parent.tab().getByRole("button", { name: "WEB-3: Webhook, In progress" }));
  assert.deepEqual(parent.view.experimental_panelCalls, [issueTabCall("WEB-3", "Webhook")]);
  cleanup();

  const sub = await opened("WEB-3", board, { feedOf });
  assert.deepEqual(headings(sub.tab()), ["Parent", "Depends on", "Done when", "Activity"]);
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
