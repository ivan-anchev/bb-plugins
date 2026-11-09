// The `submit_review` agent tool: offered only to review threads, validated against the
// diff the thread was prompted with, and stored by repo, PR number and head commit.
import type { BbPluginApi, PluginAgentConfigurationContext, PluginAgents, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { guideTag, prHeadKeySchema, repoTag, shortSha } from "../contract.ts";
import { submitReviewInputSchema, type SubmitReviewInput } from "../guide/guide-schema.ts";
import { validateSubmission } from "../guide/validate-submission.ts";
import type { Store } from "./store.ts";

const TOOL = "submit_review";

// The parts of bb the tool uses.
type Bb = {
  pluginId: string;
  agents: Pick<PluginAgents, "registerTool" | "configure">;
  sdk: { threads: Pick<BbPluginApi["sdk"]["threads"], "defaultExecutionOptions"> };
  rpc: Pick<BbPluginApi["rpc"], "experimental_invalidate">;
};

type ToolStore = Pick<Store, "runForThread" | "snapshotFiles" | "saveGuide">;

export function registerSubmitReviewTool(bb: Bb, store: ToolStore): void {
  bb.agents.registerTool({
    name: TOOL,
    description:
      "Submit the guided review of this pull request: call it once, at the end, with the complete guide. A rejected call saves nothing and lists every problem to fix.",
    instructions: TOOL_INSTRUCTIONS,
    presentation: { label: { pending: "Submitting the guide", completed: "Submitted the guide" }, icon: { glyph: "GitPullRequest" } },
    parameters: submitReviewInputSchema,
    execute: (input, ctx) => submitReview(bb, store, input, ctx.threadId),
  });

  // Synchronous, so it can only read the context: the thread's origin and metadata decide
  // whether the tool is offered. execute checks the run table, the real authority, because
  // the thread's own agent can write its metadata.
  bb.agents.configure((ctx) => ({ tools: isReviewThread(bb.pluginId, ctx) ? [TOOL] : [], skills: [] }));
}

function isReviewThread(pluginId: string, ctx: PluginAgentConfigurationContext): boolean {
  // Start writes the PR head the thread reviews into its plugin metadata.
  return ctx.origin.pluginId === pluginId && prHeadKeySchema.safeParse(ctx.pluginMetadata).success;
}

// A submission names the head it was written for, and is stored only when that is the head
// of the thread's run. A PR keeps one run, its newest review request (store.saveRun): a thread
// has no run once its review was cancelled or a new Start replaced it, and Update moves its run
// to the new head. So a guide written before either, even one whose diff is identical, never
// lands on another head, nor on a head the PR has moved past.
// The one await comes first. Cancel, Start and Update change runs while it is pending, so from
// the run lookup to the write the tool runs synchronously, and the run it checks is the run it
// writes for.
async function submitReview(bb: Bb, store: ToolStore, { headSha, ...input }: SubmitReviewInput, threadId: string): Promise<PluginAgentToolResult> {
  const model = (await bb.sdk.threads.defaultExecutionOptions({ threadId }))?.model ?? null;

  const run = store.runForThread(threadId);
  if (run === null || run.key.headSha !== headSha) return rejected(notWritingFor(headSha));

  const validation = validateSubmission(input, store.snapshotFiles(run.key));
  if (!validation.ok) return rejected(validation.message);

  store.saveGuide({ key: run.key, threadId, model, submittedAt: Date.now(), guide: validation.guide });
  bb.rpc.experimental_invalidate([repoTag(run.key.repo), guideTag(run.key)]);

  const { steps, findings } = validation.guide;
  return `Guide saved for #${run.key.number} at ${shortSha(run.key.headSha)}: ${count(steps.length, "step")}, ${count(findings.length, "finding")}. The user reads it in PR Reviews. You are done unless they ask you something.`;
}

// Never names the run's head: a turn written for an older head would only copy it.
const notWritingFor = (headSha: string) =>
  `submit_review was rejected and nothing was saved: this thread is not writing a guide for ${JSON.stringify(headSha)} in PR Reviews. If that is not the full head commit PR Reviews named when it asked for this guide, call again with that commit. Otherwise the review was cancelled, or a newer review of this pull request replaced it: stop here, and act on any newer message from PR Reviews.`;

const rejected = (text: string): PluginAgentToolResult => ({ content: [{ type: "text", text }], isError: true });

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Appended to the thread's instructions while the tool is in its set (at most 4096 characters).
const TOOL_INSTRUCTIONS = `submit_review takes the whole guide in one call:
- headSha: the full head commit the guide is for, exactly as PR Reviews named it when it asked for this guide.
- overview: problem (why the PR exists), approach (how it solves it), and behaviour {before: [...], after: [...]} only when behaviour actually changes.
- steps: 1 to 7, in reading order. Each has a title (no step number: the page numbers the steps), an explanation, an optional forYou (a decision only the reviewer can make), and hunks: [{file, hunk, collapsed?}]. Set collapsed to a one-line reason for a hunk that needs no reading.
- hidden: hunks or whole files left out of the steps, each with a reason: {file, hunk, reason} or {files: [...], reason}. Never tests or mocks: put them in a step, and the app hides them until the reader asks.
- findings: {file, line, side?, priority: "p0" (must fix) | "p1" (should fix) | "p2" (nit), title, body}. The line must be inside one of the file's hunks; side is "new" unless the line was removed.
Name files and hunks exactly as the hunk list in your first message prints them: a hunk by its range header, e.g. "@@ -18,9 +18,19 @@", and a file without text changes by "whole file". Every hunk must appear exactly once across steps and hidden. If a call is rejected, fix every problem it lists and call submit_review again with the whole guide.`;
