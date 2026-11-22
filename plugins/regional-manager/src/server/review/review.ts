// The review stage: before a done handoff's verifier starts, the plugin starts a hidden reviewer in
// the agent's environment, on a model other than the agent's and, when bb runs one, other than the
// one its verifier will run on, so the verifier's triage of its findings is independent. Its first
// message is the diff, the issue's brief and done-criteria, and CREW.md (reviewer-brief.ts); what
// it runs is CREW.md's. It reports through issue_review (review-tool.ts). A review never holds an
// issue up: a reviewer bb won't start, or that is gone, idle without findings, stalled, or asking
// what bb won't let the plugin decline, ends the review as missed, and verification goes ahead,
// its verdict saying no review was had. The verify step calls start and follow in the issue's turn
// (verify.ts reviewInTurn), which owns when the environment changes hands.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Agent } from "../../model/agent.ts";
import type { Execution } from "../../model/execution.ts";
import type { HandoffCheck, CheckId } from "../../model/verdict/check.ts";
import { memoryFileSchema } from "../../model/memory-file.ts";
import type { ReviewFinding } from "../../model/verdict/review.ts";
import { isRunning, listedThreads, stopThreads, type StopBb } from "../agents/threads.ts";
import type { CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Spawner } from "../spawn.ts";
import type { ReviewFrom } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import { declineAsks, type AsksBb } from "../verify/verifier-asks.ts";
import { verifierExecution, type VerifierChoice } from "../verify/verifier-model.ts";
import { stalled, STALL_MS, type ActivityBb } from "../verify/verifier-stall.ts";
import { reviewerBrief } from "./reviewer-brief.ts";

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

/** A thread as the review stage lists it. */
type ListedThread = Pick<ThreadRow, "id" | "environmentId" | "status" | "hasPendingInteraction" | "createdAt" | "archivedAt" | "deletedAt">;

/** The parts of bb the review stage uses, down to the fields it reads. */
type ReviewBb = CatalogBb &
  ThreadExecutionBb &
  AsksBb &
  ActivityBb &
  StopBb & {
    log: Pick<PluginLogger, "warn">;
    sdk: {
      threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> };
      environments: { get(args: { environmentId: string }): Promise<{ defaultBranch: string | null }> };
    };
  };

type Deps = {
  bb: ReviewBb;
  store: Pick<Store, "check" | "agent" | "issue" | "coordinator" | "missReview" | "recordReviewDeclined" | "receiveReview">;
  spawner: Pick<Spawner, "checker">;
  memory: MemoryRoot;
  turns: IssueTurns;
  now(): number;
};

/** What became of a reviewer's findings: stored, or refused, as its review no longer waits for them. */
type Received = "recorded" | "not-running";

const CREW_RULES = memoryFileSchema.parse("CREW.md");

export type Review = ReturnType<typeof createReview>;

export function createReview({ bb, store, spawner, memory, turns, now }: Deps) {
  /** The agent whose handoff the check judges. why throw: a handoff's check is made of a bound agent's handoff, and agents are kept while their regional manager is. */
  function agentOf({ coordinatorId, subject }: HandoffCheck): Agent & { threadId: string } {
    const agent = store.agent(coordinatorId, subject.agentId);
    if (agent === null || agent.threadId === null) throw new Error(`The agent ${subject.agentId} of ${coordinatorId} has no thread.`);
    return { ...agent, threadId: agent.threadId };
  }

  /** Ends the review as missed, from where it is, and stops its reviewer, if it had one: it holds the agent's environment, still on what held it. */
  async function miss(check: HandoffCheck, from: ReviewFrom, reason: string): Promise<void> {
    if (!store.missReview(check.id, from, reason) || from.state !== "running") return;
    const { unstopped } = await stopThreads(bb, [from.reviewerThreadId]);
    for (const { why } of unstopped) bb.log.warn(`The reviewer ${from.reviewerThreadId} of check ${check.id}, whose review was missed, ${why}; nothing waits on it.`);
  }

  /** Everything the reviewer of a check needs: its role, where it runs, on what, and its first message. */
  async function requestFor(check: HandoffCheck) {
    const coordinator = store.coordinator(check.coordinatorId);
    const issue = store.issue(check.coordinatorId, check.issueId);
    // why throw: checks are kept while their issue and regional manager are, and an agent starts only on an issue with a brief.
    if (coordinator === null || issue === null || issue.brief === null) throw new Error(`The issue ${check.issueId} of ${check.coordinatorId}, its brief or its regional manager is missing.`);
    const agent = agentOf(check);
    const environmentId = (await listedThreads(bb, [agent.threadId])).get(agent.threadId)?.environmentId ?? null;
    if (environmentId === null) throw new Error("the agent's thread has no environment to review");
    const [execution, { defaultBranch }] = await Promise.all([
      reviewerExecution(bb, { named: check.verifier, manager: await threadExecution(bb, coordinator.threadId), theirs: [agent.execution], routing: { environmentId } }),
      bb.sdk.environments.get({ environmentId }),
    ]);
    return {
      role: { kind: "reviewer", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id } as const,
      coordinator,
      parentThreadId: agent.threadId,
      title: `Review ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId } as const,
      execution,
      prompt: reviewerBrief({ ...issue, brief: issue.brief, doneCriteria: check.criteria }, { ...check.subject, defaultBranch }, memory.of(check.coordinatorId).read(CREW_RULES).text),
    };
  }

  return {
    /**
     * In its issue's turn, once bb reports its agent idle and the issue is quiet for a reviewer:
     * starts the check's reviewer while its review is queued. One bb won't start, or whose request
     * can't be made, ends the review as missed, so its verifier starts instead.
     */
    async start(check: HandoffCheck): Promise<void> {
      try {
        await spawner.checker(await requestFor(check));
      } catch (error) {
        // why only from queued: bb may have made the thread and bound it through thread.created, with only its answer lost.
        await miss(check, { state: "queued" }, `bb did not start a reviewer: ${messageOf(error)}`);
      }
    },

    /**
     * In its issue's turn: a running reviewer nobody but the plugin watches, as a verifier is
     * (verify.ts watchRunning). Whatever its provider asks a person is declined and kept on the
     * review. It is missed, and stopped, when its thread is gone, when it went idle without
     * reporting, when bb refused the plugin's decline, and when it showed no activity for
     * STALL_MS. why no reminder, as a verifier gets: a review is advice for the verifier, and a
     * missed one costs only itself.
     */
    async follow(check: HandoffCheck): Promise<void> {
      const { review } = check;
      if (review.state !== "running") return;
      const { reviewerThreadId } = review;
      const from = { state: "running", reviewerThreadId } as const;
      const thread = (await listedThreads(bb, [reviewerThreadId])).get(reviewerThreadId) ?? null;
      if (thread === null) return miss(check, from, "its reviewer thread was archived or deleted before it reported");
      if (!isRunning(thread)) return miss(check, from, "its reviewer ended its turn without reporting");
      if (thread.hasPendingInteraction) {
        const declined = await declineAsks(bb, thread.id);
        const refused = declined.find(({ refused }) => refused !== null);
        if (refused !== undefined) return miss(check, from, `its reviewer asked a person "${refused.asked}", and bb refused the plugin's decline: ${refused.refused}`);
        store.recordReviewDeclined(check.id, thread.id, declined.map(({ asked }) => asked));
        return;
      }
      if (await stalled(bb, thread.id, thread.createdAt, now())) await miss(check, from, `its reviewer showed no activity for ${STALL_MS / 60_000} minutes`);
    },

    /**
     * In its issue's turn: stores a reviewer's findings on its check, if it is still that check's
     * running reviewer and the check still waits for its verifier, with the model bb ran it on. Its
     * verifier starts once bb reports the reviewer idle (verify.ts lookAgain), or at the next tick.
     */
    reported(checkId: CheckId, reviewerThreadId: string, findings: readonly ReviewFinding[]): Promise<Received | Busy> {
      const check = store.check(checkId);
      // why throw: a reviewer is started for a check, and checks are kept while their regional manager is.
      if (check === null) throw new Error(`The check ${checkId} is missing.`);
      return turns.run(check.coordinatorId, check.issueId, async () => {
        const ran = await threadExecution(bb, reviewerThreadId);
        // why throw: the reviewer calls issue_review from inside a turn, so bb has its model on record.
        if (ran === null) throw new Error(`bb has no model on record for ${reviewerThreadId}.`);
        return store.receiveReview(checkId, reviewerThreadId, findings, { providerId: ran.providerId, model: ran.model }) ? "recorded" : "not-running";
      });
    },
  };
}

/**
 * What a reviewer runs on: never the model of the agent whose work it reviews, nor, while bb runs
 * another there, the one the check's verifier is chosen on now, so the verifier's triage is
 * independent of it. The same order as a verifier's, with the verifier's model kept away from as
 * the agent's is; when bb runs nothing else, the verifier's model, and the agent's only as a last resort.
 */
async function reviewerExecution(bb: CatalogBb, choice: VerifierChoice): Promise<Execution> {
  const verifier = await verifierExecution(bb, choice);
  return verifierExecution(bb, { ...choice, named: null, theirs: [verifier, ...choice.theirs] });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
