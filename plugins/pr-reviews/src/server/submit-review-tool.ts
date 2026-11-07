// The `submit_review` agent tool: offered only to review threads, validated against the
// diff the thread was prompted with, and stored by repo, PR number and head commit.
import type { BbPluginApi, PluginAgentConfigurationContext, PluginAgents, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { guideTag, prHeadKeySchema, repoTag } from "../contract.ts";
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

type ToolStore = Pick<Store, "latestRunForThread" | "snapshotFiles" | "saveGuide">;

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

// A thread's newest run names the PR head it writes for. A thread with no run was cancelled,
// or a later Start for the same head replaced its run (review_runs holds one run per head),
// so its guide would land on a review the user no longer waits for: it is refused.
// The one await comes first. Cancel and Start change runs while it is pending, so from the
// run lookup to the write the tool runs synchronously, and the run it checks is the run it
// writes for.
async function submitReview(bb: Bb, store: ToolStore, input: SubmitReviewInput, threadId: string): Promise<PluginAgentToolResult> {
  const model = (await bb.sdk.threads.defaultExecutionOptions({ threadId }))?.model ?? null;

  const run = store.latestRunForThread(threadId);
  if (run === null) return rejected(NOT_THE_REVIEW);

  const validation = validateSubmission(input, store.snapshotFiles(run.key));
  if (!validation.ok) return rejected(validation.message);

  store.saveGuide({ key: run.key, threadId, model, submittedAt: Date.now(), guide: validation.guide });
  bb.rpc.experimental_invalidate([repoTag(run.key.repo), guideTag(run.key)]);

  const { steps, findings } = validation.guide;
  return `Guide saved for #${run.key.number} at ${run.key.headSha.slice(0, 7)}: ${count(steps.length, "step")}, ${count(findings.length, "finding")}. The user reads it in PR Reviews. You are done unless they ask you something.`;
}

const NOT_THE_REVIEW =
  "submit_review was rejected and nothing was saved: this thread is no longer writing a guide in PR Reviews. Its review was cancelled, or a newer review of this pull request replaced it. Stop here unless the user asks you to continue.";

const rejected = (text: string): PluginAgentToolResult => ({ content: [{ type: "text", text }], isError: true });

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Appended to the thread's instructions while the tool is in its set (at most 4096 characters).
const TOOL_INSTRUCTIONS = `submit_review takes the whole guide in one call:
- overview: problem (why the PR exists), approach (how it solves it), and behaviour {before: [...], after: [...]} only when behaviour actually changes.
- steps: 1 to 7, in reading order. Each has a title, an explanation, an optional forYou (a decision only the reviewer can make), and hunks: [{file, hunk, collapsed?}]. Set collapsed to a one-line reason for a hunk that needs no reading.
- hidden: hunks or whole files left out of the steps, each with a reason: {file, hunk, reason} or {files: [...], reason}. Never tests or mocks: put them in a step, and the app hides them until the reader asks.
- findings: {file, line, side?, priority: "p0" (must fix) | "p1" (should fix) | "p2" (nit), title, body}. The line must be inside one of the file's hunks; side is "new" unless the line was removed.
Name files and hunks exactly as the hunk list in your first message prints them: a hunk by its range header, e.g. "@@ -18,9 +18,19 @@", and a file without text changes by "whole file". Every hunk must appear exactly once across steps and hidden. If a call is rejected, fix every problem it lists and call submit_review again with the whole guide.`;
