import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgents, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import Database from "better-sqlite3";
import type { PrDetail } from "../contract.ts";
import { parsePrDiff } from "../diff/parse-pr-diff.ts";
import { submitReviewInputSchema, type SubmitReviewInput } from "../guide/guide-schema.ts";
import { validateSubmission } from "../guide/validate-submission.ts";
import { repoSchema } from "../github/repo.ts";
import { reviewPrompt } from "./prompt.ts";
import { openStore, type ReviewRun } from "./store.ts";
import { registerSubmitReviewTool } from "./submit-review-tool.ts";

const PLUGIN_ID = "pr-reviews";
const repo = repoSchema.parse("ivan-anchev/bb-plugins");
const KEY = { repo, number: 23, headSha: "aedf6ce0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" };
// The live fixture PR's diff: segment-keys.test.ts @@ -13,13 +13,18 @@ and segment-keys.ts @@ -1,8 +1,10 @@.
const DIFF = readFileSync(new URL("../diff/fixtures/github-pr.diff", import.meta.url), "utf8");
const TEST_FILE = "plugins/code-explorer/src/ui/segment-keys.test.ts";
const SOURCE_FILE = "plugins/code-explorer/src/ui/segment-keys.ts";

const guide: SubmitReviewInput = {
  headSha: KEY.headSha,
  overview: { problem: "segmentIndexAfterKey was undocumented.", approach: "Document it and test the edges." },
  steps: [
    {
      title: "The helper and its test",
      explanation: "The doc comment states the contract; the test pins it.",
      hunks: [
        { file: SOURCE_FILE, hunk: "@@ -1,8 +1,10 @@" },
        { file: TEST_FILE, hunk: "@@ -13,13 +13,18 @@" },
      ],
    },
  ],
  hidden: [],
  findings: [{ file: SOURCE_FILE, line: 3, priority: "p2", title: "Wording", body: "…" }],
};

type Tool = Parameters<PluginAgents["registerTool"]>[0];

// The tool as bb sees it: registered against a fake bb, over a real SQLite store. The model
// lookup answers once `modelLookup` settles, so a test can act while the tool awaits it.
function harness({ model = "claude-opus-5-5", modelLookup = Promise.resolve() }: { model?: string | null; modelLookup?: Promise<void> } = {}) {
  const db = new Database(":memory:");
  const store = openStore({ database: () => db, migrate: (handle, statements) => statements.forEach((statement) => handle.exec(statement)) });
  const invalidations: (readonly string[])[] = [];
  let tool: Tool | undefined;
  let configure: ((ctx: PluginAgentConfigurationContext) => PluginAgentConfiguration) | undefined;

  registerSubmitReviewTool(
    {
      pluginId: PLUGIN_ID,
      agents: {
        registerTool: (registered: Tool) => void (tool = registered),
        configure: (provider) => void (configure = provider),
      },
      sdk: {
        threads: {
          defaultExecutionOptions: async () => {
            await modelLookup;
            return model === null ? null : { model, permissionMode: "auto", reasoningLevel: "high", serviceTier: "default", source: "client/thread/start" };
          },
        },
      },
      rpc: { experimental_invalidate: (tags) => void invalidations.push(tags) },
    },
    store,
  );
  assert.ok(tool !== undefined && configure !== undefined);
  assert.equal(tool.parameters, submitReviewInputSchema);
  const { execute } = tool;
  const select = configure;

  // As bb calls it: the arguments parsed by the tool's schema.
  const submit = async (threadId: string, input: SubmitReviewInput = guide) =>
    resultText(await execute(submitReviewInputSchema.parse(input), { threadId, projectId: "proj_1", signal: new AbortController().signal }));
  // What Start and Update save: a run for `headSha` by `threadId`.
  const start = (threadId: string, requestedAt: number, diff = DIFF, headSha = KEY.headSha) =>
    store.saveRun({ key: { ...KEY, headSha }, threadId, requestedAt } satisfies ReviewRun, diff);

  return { store, invalidations, submit, start, toolsFor: (ctx: PluginAgentConfigurationContext) => select(ctx).tools, name: tool.name };
}

function resultText(result: PluginAgentToolResult): { error: boolean; text: string } {
  if (typeof result === "string") return { error: false, text: result };
  return { error: result.isError === true, text: result.content.map((part) => (part.type === "text" ? part.text : "")).join("") };
}

const notWritingFor = (headSha: string) =>
  `submit_review was rejected and nothing was saved: this thread is not writing a guide for "${headSha}" in PR Reviews. If that is not the full head commit PR Reviews named when it asked for this guide, call again with that commit. Otherwise the review was cancelled, or a newer review of this pull request replaced it: stop here, and act on any newer message from PR Reviews.`;
const NOT_THE_REVIEW = notWritingFor(KEY.headSha);

function threadContext(origin: string | null, pluginMetadata: PluginAgentConfigurationContext["pluginMetadata"]): PluginAgentConfigurationContext {
  return {
    pluginMetadata,
    thread: { id: "thr_1", title: "Review #23", parentThreadId: null, sourceThreadId: null },
    project: { id: "proj_1", kind: "standard", name: "bb-plugins", gitRemoteUrl: "https://github.com/ivan-anchev/bb-plugins.git" },
    environment: { id: "env_1", name: null, path: "/tmp/wt", branchName: null, workspaceProvisionType: null },
    host: { id: "host_1", name: "laptop" },
    provider: { id: "claude-code", model: "claude-opus-5-5", capabilities: { supportsNativeUserQuestion: true } },
    origin: { kind: null, pluginId: origin },
  };
}

test("only a thread PR Reviews started, with its review metadata, is offered submit_review", () => {
  const { toolsFor, name } = harness();
  const metadata = { repo: KEY.repo, number: KEY.number, headSha: KEY.headSha };
  assert.equal(name, "submit_review");
  assert.deepEqual(toolsFor(threadContext(PLUGIN_ID, metadata)), ["submit_review"]);
  assert.deepEqual(toolsFor(threadContext(null, {})), [], "a thread from bb's composer");
  assert.deepEqual(toolsFor(threadContext(null, metadata)), [], "metadata alone is not enough: any client can write it");
  assert.deepEqual(toolsFor(threadContext("side-chat", metadata)), [], "another plugin's thread");
  assert.deepEqual(toolsFor(threadContext(PLUGIN_ID, { repo: KEY.repo })), [], "a PR Reviews thread without a PR head");
});

test("a valid guide is stored for the run's head, with the thread's model, and the PR's reads refresh", async () => {
  const { store, invalidations, submit, start } = harness();
  start("thr_1", 100);

  assert.deepEqual(await submit("thr_1"), {
    error: false,
    text: "Guide saved for #23 at aedf6ce: 1 step, 1 finding. The user reads it in PR Reviews. You are done unless they ask you something.",
  });
  const record = store.guide(KEY);
  assert.ok(record !== null);
  assert.deepEqual({ ...record, submittedAt: 0 }, {
    key: KEY,
    threadId: "thr_1",
    model: "claude-opus-5-5",
    submittedAt: 0,
    guide: {
      overview: { ...guide.overview, behaviour: null },
      steps: [
        {
          title: "The helper and its test",
          explanation: "The doc comment states the contract; the test pins it.",
          forYou: null,
          hunks: [
            { file: SOURCE_FILE, hunk: "@@ -1,8 +1,10 @@", collapsed: null },
            { file: TEST_FILE, hunk: "@@ -13,13 +13,18 @@", collapsed: null },
          ],
        },
      ],
      hidden: [],
      findings: [{ file: SOURCE_FILE, line: 3, side: "new", hunk: "@@ -1,8 +1,10 @@", priority: "p2", title: "Wording", body: "…" }],
    },
  });
  assert.deepEqual(store.guideHeadsFor(repo, [23]).map(({ key, threadId }) => ({ key, threadId })), [{ key: KEY, threadId: "thr_1" }]);
  assert.deepEqual(invalidations, [["repo:ivan-anchev/bb-plugins", `guide:ivan-anchev/bb-plugins#23@${KEY.headSha}`]]);
});

test("a guide whose model bb does not report is stored with a null model", async () => {
  const { store, submit, start } = harness({ model: null });
  start("thr_1", 100);
  await submit("thr_1");
  assert.equal(store.guide(KEY)?.model, null);
});

test("an invalid guide is rejected with the validator's message and saves nothing", async () => {
  const { store, invalidations, submit, start } = harness();
  start("thr_1", 100);
  const [step] = guide.steps;
  const result = await submit("thr_1", { ...guide, steps: [{ ...step, hunks: [step.hunks[0]] }] });
  assert.equal(result.error, true);
  assert.match(result.text, /^submit_review was rejected and nothing was saved\./);
  assert.match(result.text, /Missing: these hunks are in no step and not in hidden \(1\):\n {2}- "plugins\/code-explorer\/src\/ui\/segment-keys.test.ts" @@ -13,13 \+13,18 @@$/);
  assert.equal(store.guide(KEY), null);
  assert.deepEqual(invalidations, []);
});

test("a thread with no run, such as a cancelled review, is refused", async () => {
  const { store, submit, start } = harness();
  start("thr_1", 100);
  store.deleteRun(KEY);
  assert.deepEqual(await submit("thr_1"), { error: true, text: NOT_THE_REVIEW });
  assert.equal(store.guide(KEY), null);
});

test("a thread whose run a later Start for the same head replaced is refused; the newer thread's guide is stored", async () => {
  const { store, submit, start } = harness();
  start("thr_old", 100);
  start("thr_new", 200);

  assert.deepEqual(await submit("thr_old"), { error: true, text: NOT_THE_REVIEW });
  assert.equal(store.guide(KEY), null);

  assert.equal((await submit("thr_new")).error, false);
  assert.equal(store.guide(KEY)?.threadId, "thr_new");
});

// Cancel, Start or Update acting while the tool awaits the thread's model: `setup` runs before
// the call, `act` mid-lookup.
async function submitDuring(
  act: (h: ReturnType<typeof harness>) => void,
  { setup = (h) => h.start("thr_1", 100), input = guide }: { setup?: (h: ReturnType<typeof harness>) => void; input?: SubmitReviewInput } = {},
) {
  let answerLookup = () => {};
  const h = harness({ modelLookup: new Promise<void>((resolve) => (answerLookup = resolve)) });
  setup(h);
  const pending = h.submit("thr_1", input);
  act(h);
  answerLookup();
  return { h, result: await pending };
}

test("a review cancelled while the tool looks up the model is refused and stores no guide", async () => {
  const { h, result } = await submitDuring(({ store }) => store.deleteRun(KEY));
  assert.deepEqual(result, { error: true, text: NOT_THE_REVIEW });
  assert.equal(h.store.guide(KEY), null);
  assert.deepEqual(h.invalidations, []);
});

test("a review replaced while the tool looks up the model is refused and stores no guide", async () => {
  const { h, result } = await submitDuring(({ start }) => start("thr_new", 200));
  assert.deepEqual(result, { error: true, text: NOT_THE_REVIEW });
  assert.equal(h.store.guide(KEY), null);
  assert.deepEqual(h.invalidations, []);
});

test("paths with a leading space, a trailing space or a byte-order mark round-trip from the prompt to the stored guide", async () => {
  // Real `git diff` output for " lead.ts", "trail.ts " and "<U+FEFF>bom.ts", each with one hunk.
  const diff = readFileSync(new URL("../diff/fixtures/space-paths.diff", import.meta.url), "utf8");
  const paths = promptedPaths(diff);
  assert.deepEqual(paths, [" lead.ts", "trail.ts ", "\uFEFFbom.ts"]);

  const { store, submit, start } = harness();
  start("thr_1", 100, diff);
  const [lead, trail, bom] = paths;
  const result = await submit("thr_1", {
    headSha: KEY.headSha,
    overview: guide.overview,
    steps: [{ title: "Lead", explanation: "The leading-space file.", hunks: [{ file: lead, hunk: "@@ -1,2 +1,2 @@" }] }],
    hidden: [
      { file: trail, hunk: "@@ -1,2 +1,2 @@", reason: "Same change." },
      { files: [bom], reason: "Same change." },
    ],
    findings: [{ file: trail, line: 2, priority: "p2", title: "Name", body: "The path ends in a space." }],
  });

  assert.equal(result.error, false, result.text);
  const record = store.guide(KEY);
  assert.ok(record !== null);
  const { steps, hidden, findings } = record.guide;
  assert.deepEqual(steps.map((step) => step.hunks.map((hunk) => hunk.file)), [[lead]]);
  assert.deepEqual(hidden.map((item) => (item.kind === "hunk" ? [item.file] : item.files)), [[trail], [bom]]);
  assert.deepEqual(findings.map((finding) => finding.file), [trail]);
});

for (const fixture of ["line-separator-paths.diff", "line-separator-paths-raw.diff"]) {
  test(`modified and renamed paths with U+2028, U+2029, a byte-order mark and edge spaces round-trip to the stored guide (${fixture})`, async () => {
    // Real `git diff` output: a pure rename first, then edited files and renames, one hunk each.
    const diff = readFileSync(new URL(`../diff/fixtures/${fixture}`, import.meta.url), "utf8");
    const [pureRename, ...edited] = promptedPaths(diff);
    assert.deepEqual(
      [pureRename, ...edited],
      [" pure moved .ts", " ﻿all  .ts ", "line sep.ts", "new name.ts", "new name.ts", "para sep.ts", "﻿new  .ts "],
    );

    const { store, submit, start } = harness();
    start("thr_1", 100, diff);
    const result = await submit("thr_1", {
      headSha: KEY.headSha,
      overview: guide.overview,
      steps: [{ title: "Edits", explanation: "Every edited file.", hunks: edited.map((file) => ({ file, hunk: "@@ -1,6 +1,6 @@" })) }],
      hidden: [{ files: [pureRename], reason: "A pure rename." }],
      findings: edited.map((file) => ({ file, line: 3, priority: "p2" as const, title: "Name", body: "The path is exotic." })),
    });

    assert.equal(result.error, false, result.text);
    const record = store.guide(KEY);
    assert.ok(record !== null);
    const { steps, hidden, findings } = record.guide;
    assert.deepEqual(steps.map((step) => step.hunks.map((hunk) => hunk.file)), [edited]);
    assert.deepEqual(hidden.map((item) => (item.kind === "hunk" ? [item.file] : item.files)), [[pureRename]]);
    assert.deepEqual(findings.map((finding) => finding.file), edited);
  });
}

// The paths the review agent reads in its prompt's hunk list, decoded as it decodes them.
function promptedPaths(diff: string): string[] {
  const pr: PrDetail = {
    number: KEY.number,
    title: "Paths",
    author: "ivan-anchev",
    updatedAt: "2026-11-06T17:00:00Z",
    headSha: KEY.headSha,
    body: "",
    url: "https://github.com/ivan-anchev/bb-plugins/pull/23",
    headRefName: "paths",
    baseRefName: "main",
    state: "OPEN",
    commits: [KEY.headSha],
    additions: 1, deletions: 1, checks: [], reviewers: [], labels: [],
  };
  const prompt = reviewPrompt({ repo, pr, headSha: KEY.headSha, baseSha: KEY.headSha, files: parsePrDiff(diff) }, "");
  return [...prompt.matchAll(/^- ("(?:[^"\\]|\\.)*"): /gm)].map(([, literal]) => JSON.parse(literal));
}

test("a second guide for the same head replaces the first", async () => {
  const { store, submit, start } = harness();
  start("thr_1", 100);
  await submit("thr_1");
  await submit("thr_1", { ...guide, overview: { ...guide.overview, problem: "Second take." } });
  assert.equal(store.guideHeadsFor(repo, [23]).length, 1);
  assert.equal(store.guide(KEY)?.guide.overview.problem, "Second take.");
});

// ---- Update reuses the review thread: every submission belongs to one run and one head ----

// The PR's next head. The commit is empty, so its diff is identical to KEY's and only the head
// tells a guide for one from a guide for the other.
const NEXT = { ...KEY, headSha: "b7c9e2d41f0a3b5c6d7e8f9a0b1c2d3e4f5a6b7c" };
const updated = { ...guide, headSha: NEXT.headSha, overview: { ...guide.overview, problem: "Updated for the new head." } };

// thr_1 wrote KEY's guide; then Update asked it, by message, to write NEXT's.
function guidedThenUpdated(h: ReturnType<typeof harness>) {
  h.start("thr_1", 100);
  const written = validateSubmission(guide, parsePrDiff(DIFF));
  assert.ok(written.ok);
  h.store.saveGuide({ key: KEY, threadId: "thr_1", model: "claude-opus-5-5", submittedAt: 150, guide: written.guide });
  h.start("thr_1", 200, DIFF, NEXT.headSha);
}

const problemOf = (h: ReturnType<typeof harness>, key: typeof KEY) => h.store.guide(key)?.guide.overview.problem ?? null;

test("Update queued behind a turn: that turn's guide for the old head is refused, and only the updated guide lands on the new head", async () => {
  const h = harness();
  guidedThenUpdated(h);

  // The turn that was running when Update queued its message has not read it yet.
  const oldTurn = { ...guide, overview: { ...guide.overview, problem: "Written before the update." } };
  assert.deepEqual(await h.submit("thr_1", oldTurn), { error: true, text: NOT_THE_REVIEW });
  assert.equal(problemOf(h, KEY), guide.overview.problem, "the old head's guide is untouched");
  assert.equal(h.store.guide(NEXT), null, "nothing lands on the new head");

  // The next turn reads the update message and names the head it gave.
  assert.deepEqual(await h.submit("thr_1", updated), {
    error: false,
    text: "Guide saved for #23 at b7c9e2d: 1 step, 1 finding. The user reads it in PR Reviews. You are done unless they ask you something.",
  });
  assert.equal(problemOf(h, NEXT), "Updated for the new head.");
  assert.equal(problemOf(h, KEY), guide.overview.problem);
});

test("Update landing while an older turn's submission awaits the model refuses it and stores nothing", async () => {
  const { h, result } = await submitDuring((h) => h.start("thr_1", 200, DIFF, NEXT.headSha), { setup: (h) => h.start("thr_1", 100) });
  assert.deepEqual(result, { error: true, text: NOT_THE_REVIEW });
  assert.equal(h.store.guide(KEY), null);
  assert.equal(h.store.guide(NEXT), null);
  assert.deepEqual(h.invalidations, []);
});

test("a cancelled Update refuses a late submission for either head and keeps the old guide", async () => {
  // Cancel withdraws the update's run while its submission awaits the model.
  const { h, result } = await submitDuring((h) => h.store.deleteRun(NEXT), { setup: guidedThenUpdated, input: updated });
  assert.deepEqual(result, { error: true, text: notWritingFor(NEXT.headSha) });

  // The run for the old head does not come back: the old guide cannot be overwritten either.
  const rewrite = { ...guide, overview: { ...guide.overview, problem: "Rewritten after the cancel." } };
  assert.deepEqual(await h.submit("thr_1", rewrite), { error: true, text: NOT_THE_REVIEW });

  assert.equal(problemOf(h, KEY), guide.overview.problem);
  assert.equal(h.store.guide(NEXT), null);
  assert.deepEqual(h.invalidations, []);
});

test("once a new review of a newer head starts in another thread, the old thread cannot overwrite its guide", async () => {
  const h = harness();
  h.start("thr_1", 100);
  assert.equal((await h.submit("thr_1")).error, false);
  h.start("thr_2", 200, DIFF, NEXT.headSha);

  const rewrite = { ...guide, overview: { ...guide.overview, problem: "Rewritten later." } };
  assert.deepEqual(await h.submit("thr_1", rewrite), { error: true, text: NOT_THE_REVIEW });
  assert.equal(problemOf(h, KEY), guide.overview.problem);
  assert.equal(h.store.guide(KEY)?.threadId, "thr_1");
});
