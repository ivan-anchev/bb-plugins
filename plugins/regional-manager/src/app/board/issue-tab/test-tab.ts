// Tests only: an issue's tab as bb mounts it in its regional manager's side panel, with the params it
// was opened with, reading the plugin: the issue's row and the rows its relations name from the
// board's read, its feed from issueFeed and the rounds opened in it from roundBodies. bb hands the
// same params back after a reload, so a tab mounted with them is the tab that survived one. And a
// BBP-19-shaped feed to mount it with.
import "../../test-browser.ts";
import assert from "node:assert/strict";
import type { ExperimentalFilePreviewOptions, JsonValue, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, within } from "@testing-library/react";
import { coordinatorContract, issueTag, parseRoundBodyKey, type IssueFeed, type IssueRow } from "../../../contract.ts";
import { agentIdSchema } from "../../../model/agent/agent.ts";
import { handoffIdSchema } from "../../../model/agent/handoff.ts";
import { decisionIdSchema } from "../../../model/decision.ts";
import type { Entry } from "../../../model/feed/entry.ts";
import { roundKeySchema, type Round, type RoundBody } from "../../../model/feed/round.ts";
import { issueIdSchema } from "../../../model/issue/issue.ts";
import { coordinatorIdSchema } from "../../../model/role.ts";
import type { CriterionResult, ShownVerdict } from "../../../model/verdict/verdict.ts";
import { PROJECT, PROVIDERS, sidebarThread } from "../../test-sidebar.ts";

// why: jsdom has none of these; the working ring asks for Reduce motion and a canvas.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    disconnect() {}
  },
  matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
});
HTMLCanvasElement.prototype.getContext = () => null;

export const { issueTab } = await import("./issue-tab.tsx");

export const COORDINATOR = { id: coordinatorIdSchema.parse("6f1c2b0e-8d4a-4c1e-9f3b-2a7d5e8c9b10"), threadId: "thr_1", projectId: PROJECT.id, description: null, avatar: { kind: "blob", shape: "circle", hue: "purple", expression: "neutral" } } as const;
/** The name bb shows COORDINATOR's thread by, which names the regional manager. */
export const MANAGER_NAME = "Webhook retries";
export const SHA = "4b1d9e0c2a7f3e5d6c8b9a0f1e2d3c4b5a697881";
export const id = (raw: string) => issueIdSchema.parse(raw);
export const agent = (raw: string) => ({ id: agentIdSchema.parse(raw), threadId: `thr_${raw}` });
/** An agent as an issue's feed lists it: on `providerId`, ended at `endedAt` (null: it holds the issue). */
export const assignee = (raw: string, providerId: string, endedAt: number | null): IssueFeed["agents"][number] => ({ ...agent(raw), providerId, ended: endedAt === null ? null : { at: endedAt } });

export const issue = (raw: string, fields: Partial<IssueRow>): IssueRow => ({
  id: id(raw),
  kind: "build",
  parentId: null,
  subIssues: null,
  blockedBy: [],
  blocks: [],
  title: `Title of ${raw}`,
  status: "todo",
  needsYou: null,
  headline: "Not started",
  agent: null,
  pr: null,
  ...fields,
});

export const CRITERIA = ["Retries land", "npm test passes", "Escape closes the card"];
const [A1, A2] = [agentIdSchema.parse("a1"), agentIdSchema.parse("a2")];
const handoffId = (n: number) => handoffIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
export const roundKey = (n: number) => roundKeySchema.parse(`h-${handoffId(n)}`);

/** Round `number` by `agentId`, its verdict's results, the fix round its findings reached the agent as (null: none went back). */
function round(number: number, agentId: typeof A1, at: number, results: CriterionResult[], fixRound: number | null): Round {
  const failed = results.some((result) => result !== "pass");
  return {
    key: roundKey(number),
    number,
    handed: { at, moved: null },
    by: { kind: "agent", agentId, status: "done", summary: `Round ${number}: retries land with backoff` },
    review: { state: "reported", step: { at: at + 100, moved: null }, findings: 2, held: 1, downgraded: 0 },
    verdict: { outcome: failed ? { kind: "fail", by: "criteria" } : { kind: "pass" }, results, fixRound: fixRound === null ? null : { round: fixRound, delivery: "sent" }, step: { at: at + 500, moved: null }, asked: null },
    outcome: { at: at + 600, moved: null },
    inFlight: false,
  };
}

const roundEntry = (made: Round): Entry => ({ kind: "round", round: made });

/** BBP-19 in short: a1 failed twice and was replaced, a2 passed; a question answered, one open; #219 merged. */
export const FEED: IssueFeed = {
  description: "Failed webhook deliveries are lost.",
  brief: "Retry failed deliveries with backoff.",
  doneCriteria: CRITERIA,
  dependsOn: [],
  blocks: [],
  agents: [assignee("a1", "claude-code", 4_800), assignee("a2", "claude-code", null)],
  entries: [
    { kind: "created", at: 1_000, followUpOf: null },
    { kind: "agent-started", at: 2_000, agentId: A1 },
    roundEntry(round(1, A1, 3_000, ["pass", "fail", "fail"], 1)),
    { kind: "decision", decision: { kind: "asked", id: decisionIdSchema.parse("d1"), question: "Keep the row's facts?", options: ["Keep", "Hide"], recommended: null, at: 3_700, answer: { text: "Keep", at: 3_800 }, cap: null } },
    roundEntry(round(2, A1, 4_000, ["pass", "pass", "fail"], null)),
    { kind: "decision", decision: { kind: "recorded", text: "a1 loops: hand the issue to a fresh agent.", at: 4_700 } },
    { kind: "agent-ended", at: 4_800, agentId: A1, how: "replaced" },
    { kind: "agent-started", at: 4_800, agentId: A2 },
    roundEntry(round(3, A2, 5_000, ["pass", "pass", "pass"], null)),
    { kind: "pr", at: 6_000, pr: { forge: "github", number: 219, url: "https://github.com/acme/webhooks/pull/219", state: "merged", draft: false, ci: "pass", failedChecks: [] }, changes: ["ci-passed", "merged"] },
    { kind: "thread", at: 6_100, agentId: A2, event: { kind: "reported-back", lastAnswer: "Merged; nothing left." } },
    { kind: "unblocked", at: 6_200, by: id("WEB-7") },
    { kind: "decision", decision: { kind: "asked", id: decisionIdSchema.parse("d2"), question: "Ship #219 to everyone now?", options: ["Ship now", "Wait a day"], recommended: null, at: 6_300, answer: null, cap: null } },
  ],
};

/** A returned verdict on round `n`, judging CRITERIA as `results` say. */
function verdictOf(n: number, results: readonly CriterionResult[]): ShownVerdict {
  return {
    state: "returned",
    verifierThreadId: `thr_verifier_${n}`,
    headSha: SHA,
    checkout: { headSha: SHA, changedFiles: [], changedFileCount: 0 },
    criteria: results.map((result, i) => ({ criterion: CRITERIA[i] ?? "", result, shows: "Ran it.", evidence: `Round ${n}, criterion ${i + 1}: ${result === "pass" ? "ok" : "1 failing: caps the backoff"}` })),
    findings: [],
    blocking: [],
    sameModel: false,
    settlement: { kind: "checked", ci: { kind: "none" } },
  };
}

/** What each round of FEED opens to. */
export function bodyOf(n: number): RoundBody {
  const results = FEED.entries.flatMap((entry) => (entry.kind === "round" && entry.round.number === n ? (entry.round.verdict?.results ?? []) : []));
  return {
    handoff: { did: ["Added exponential backoff"], evidence: ["$ npm test"], concerns: [], deviations: [], findings: [], attachments: [], report: null },
    verdict: verdictOf(n, results),
    findings: [
      { title: "Retries back off without a cap", file: "src/retry.ts", line: 4, severity: "must-fix", claim: "The backoff has no cap.", origin: "new", triage: { result: "anchored", anchor: "criterion", steps: null, reason: "Seen: it grows without bound.", effect: "blocks" } },
      { title: "The retry row's padding is off", file: "src/retry.css", line: null, severity: "nit", claim: "The padding differs from the row's.", origin: "new", triage: { result: "rejected", reason: "It matches the row.", effect: "rejected" } },
    ],
    reviewMissed: null,
  };
}

/** The body of the FEED round a roundBodies key names; null for a key naming none of them. */
function bodyOfKey(key: string): RoundBody | null {
  const named = parseRoundBodyKey(key);
  const made = FEED.entries.find((entry) => entry.kind === "round" && entry.round.key === named?.round);
  return made?.kind === "round" ? bodyOf(made.round.number) : null;
}

/** How the plugin answers a comment posted from the tab: its output, a promise of it, or a throw. */
type CommentAnswer = (input: unknown) => unknown;
/**
 * `managerListed`: whether bb lists the regional manager's thread, which names it (false: archived); `live`, the other threads bb's sidebar lists, as its agents';
 * `openAttachment`, how the plugin answers an attachment's open (default: it names the manager's thread and a path); `preview`, whether bb's panel takes a file to open (default: it does).
 */
type MountOptions = {
  feedOf?: (issueId: string) => IssueFeed;
  bodies?: (key: string) => RoundBody | null;
  comment?: CommentAnswer;
  managerListed?: boolean;
  live?: readonly PluginSidebarThread[];
  openAttachment?: (input: unknown) => unknown;
  preview?: boolean;
};

/** The tab mounted with `params`, on a board of `issues`; the reads and writes it made, and ways to make the plugin answer anew. */
export async function mount(
  params: JsonValue | null,
  issues: readonly IssueRow[],
  { feedOf = () => FEED, bodies = bodyOfKey, comment = () => ({ commentId: "m9" }), managerListed = true, live = [], openAttachment = opensInManagerStorage, preview = true }: MountOptions = {},
) {
  const feedReads: unknown[] = [];
  const opens: unknown[] = [];
  const previews: ExperimentalFilePreviewOptions[] = [];
  const bodyReads: string[][] = [];
  const answers: unknown[] = [];
  const comments: unknown[] = [];
  let currentIssues = issues;
  let currentFeed = feedOf;
  const view = renderSlot(
    { component: issueTab.component },
    { threadId: COORDINATOR.threadId, environment: null, params },
    {
      experimental_rpcContract: coordinatorContract,
      experimental_panel: { openTab: () => true },
      sidebarThreads: { status: "ready", threads: [...(managerListed ? [sidebarThread(COORDINATOR.threadId, MANAGER_NAME)] : []), ...live], projects: [PROJECT] },
      providers: { status: "ready", providers: PROVIDERS },
      openFilePreview: (options) => {
        previews.push(options);
        return preview;
      },
      rpc: {
        coordinators: () => ({ coordinators: [COORDINATOR], notStarted: [] }),
        board: () => ({ verify: true, ownEdits: null, prUnavailable: null, decisions: [], issues: currentIssues }),
        issueFeed: (input: unknown) => {
          feedReads.push(input);
          return currentFeed(coordinatorContract.issueFeed.input.parse(input).issueId);
        },
        roundBodies: (input: unknown) => {
          const { keys } = coordinatorContract.roundBodies.input.parse(input);
          bodyReads.push(keys);
          return Object.fromEntries(keys.map((key) => [key, bodies(key)]));
        },
        answerDecision: (input: unknown) => {
          answers.push(input);
          return {};
        },
        commentIssue: (input: unknown) => {
          comments.push(input);
          return comment(input);
        },
        openAttachment: (input: unknown) => {
          opens.push(input);
          return openAttachment(input);
        },
      },
    },
  );
  return {
    view,
    feedReads,
    bodyReads,
    answers,
    comments,
    /** Each attachment the tab asked the plugin to open, and each file it then asked bb's panel to preview. */
    opens,
    previews,
    /** The issue's own article; its rounds and decisions are articles inside it. */
    tab: () => within(view.container.querySelector<HTMLElement>("article.rmi-detail") ?? assert.fail("no issue drawn")),
    /** The board reads again, with `next` as its rows. */
    async reread(next: readonly IssueRow[]) {
      currentIssues = next;
      await view.experimental_invalidateRpc([`board:${COORDINATOR.id}`]);
      await act(async () => {});
    },
    /** The issue's feed reads again, as its tag is invalidated, answering `next`. */
    async refeed(issueId: string, next: (issueId: string) => IssueFeed) {
      currentFeed = next;
      await view.experimental_invalidateRpc([issueTag(COORDINATOR.id, id(issueId))]);
      await act(async () => {});
    },
  };
}

/** The plugin's answer to an attachment's open: written into the manager's thread storage, under attachments/<id>/. */
function opensInManagerStorage(input: unknown) {
  const { id } = coordinatorContract.openAttachment.input.parse(input);
  return { threadId: COORDINATOR.threadId, path: `attachments/${id}/findings.md` };
}

/** Mounted on `issueId`, once its feed has drawn. */
export async function opened(issueId: string, issues: readonly IssueRow[], options: MountOptions = {}) {
  const mounted = await mount({ issueId }, issues, options);
  // why as written: a description is Markdown, whose line breaks the default matcher would fold.
  await within(await mounted.view.findByRole("article", { name: issueId })).findByText((options.feedOf ?? (() => FEED))(issueId).description, { normalizer: (text) => text });
  return mounted;
}

/** The headings of the tab's sections, in order. */
export const headings = (tab: ReturnType<typeof within>) => tab.getAllByRole("heading", { level: 3 }).map((heading: HTMLElement) => heading.textContent);
