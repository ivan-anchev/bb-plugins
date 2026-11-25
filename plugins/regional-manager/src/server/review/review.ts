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
import { sameModel, type Execution } from "../../model/agent/execution.ts";
import type { HandoffCheck, CheckId } from "../../model/verdict/check.ts";
import type { ReviewFinding } from "../../model/verdict/review.ts";
import { handingAgent } from "../agents/handing-agent.ts";
import { isRunning, listedThreads, stopThreads, type StopBb } from "../agents/threads.ts";
import type { CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import { CREW_FILE, type MemoryRoot } from "../memory/memory-files.ts";
import type { CheckerRequest, Spawner } from "../spawn.ts";
import type { ReviewFrom } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import type { AsksBb } from "../hidden/asks.ts";
import { verifierExecution, type VerifierChoice } from "../verify/verifier-model.ts";
import { watchHidden, type ActivityBb } from "../hidden/watch.ts";
import { checkedIssue } from "../verify/verifier-brief.ts";
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
  store: Pick<Store, "check" | "agent" | "issue" | "coordinator" | "issueDecisions" | "missReview" | "receiveReview">;
  spawner: Pick<Spawner, "checker">;
  memory: MemoryRoot;
  turns: IssueTurns;
  now(): number;
};

/** What became of a reviewer's findings: stored, or refused, as its review no longer waits for them. */
type Received = "recorded" | "not-running";

export type Review = ReturnType<typeof createReview>;

export function createReview({ bb, store, spawner, memory, turns, now }: Deps) {
  /** Ends the review as missed, from where it is, and stops its reviewer, if it had one: it holds the agent's environment, still on what held it. */
  async function miss(check: HandoffCheck, from: ReviewFrom, reason: string): Promise<void> {
    if (!store.missReview(check.id, from, reason, now()) || from.state !== "running") return;
    const { unstopped } = await stopThreads(bb, [from.reviewerThreadId]);
    for (const { why } of unstopped) bb.log.warn(`The reviewer ${from.reviewerThreadId} of check ${check.id}, whose review was missed, ${why}; nothing waits on it.`);
  }

  /** Everything the reviewer of a check needs: its role, where it runs, on what, and its first message; or why none can review it independently. */
  async function requestFor(check: HandoffCheck): Promise<CheckerRequest | { none: string }> {
    const coordinator = store.coordinator(check.coordinatorId);
    // why throw: checks are kept while their regional manager is.
    if (coordinator === null) throw new Error(`The regional manager ${check.coordinatorId} of ${check.issueId} is missing.`);
    const agent = handingAgent(store, check);
    const environmentId = (await listedThreads(bb, [agent.threadId])).get(agent.threadId)?.environmentId ?? null;
    if (environmentId === null) throw new Error("the agent's thread has no environment to review");
    const [execution, { defaultBranch }] = await Promise.all([
      reviewerExecution(bb, { named: check.verifier, manager: await threadExecution(bb, coordinator.threadId), theirs: [agent.execution], routing: { environmentId } }),
      bb.sdk.environments.get({ environmentId }),
    ]);
    if (execution === null) return { none: `no independent reviewer model: bb can run none there but ${agent.id}'s own` };
    // why read here, after every await: the brief and the decisions it gives must agree (checkedIssue).
    const issue = checkedIssue(store, check.coordinatorId, check.issueId);
    return {
      role: { kind: "reviewer", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id } as const,
      coordinator,
      parentThreadId: agent.threadId,
      title: `Review ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId } as const,
      execution,
      prompt: reviewerBrief({ ...issue, doneCriteria: check.criteria }, { ...check.subject, defaultBranch }, memory.of(check.coordinatorId).read(CREW_FILE).text),
    };
  }

  return {
    /**
     * In its issue's turn, once bb reports its agent idle and the issue is quiet for a reviewer:
     * starts the check's reviewer while its review is queued. One bb won't start, whose request
     * can't be made, or that could run only on the agent's own model, ends the review as missed, so
     * its verifier starts instead.
     */
    async start(check: HandoffCheck): Promise<void> {
      try {
        const request = await requestFor(check);
        if ("none" in request) return void (await miss(check, { state: "queued" }, request.none));
        await spawner.checker(request);
      } catch (error) {
        // why only from queued: bb may have made the thread and bound it through thread.created, with only its answer lost.
        await miss(check, { state: "queued" }, `bb did not start a reviewer: ${messageOf(error)}`);
      }
    },

    /**
     * In its issue's turn: a running reviewer nobody but the plugin watches, as a verifier is
     * (watchHidden): whatever its provider asks a person is declined. It is missed, and stopped,
     * when its thread is gone, when it went idle without reporting, when bb refused the plugin's
     * decline, and when it showed no activity for STALL_MS. why no reminder, as a verifier gets: a
     * review is advice for the verifier, and a missed one costs only itself.
     */
    async follow(check: HandoffCheck): Promise<void> {
      const { review } = check;
      if (review.state !== "running") return;
      const { reviewerThreadId } = review;
      const from = { state: "running", reviewerThreadId } as const;
      const thread = (await listedThreads(bb, [reviewerThreadId])).get(reviewerThreadId) ?? null;
      if (thread === null) return miss(check, from, "its reviewer thread was archived or deleted before it reported");
      if (!isRunning(thread)) return miss(check, from, "its reviewer ended its turn without reporting");
      const watched = await watchHidden(bb, thread, "reviewer", [], now());
      if (watched.kind === "ended") await miss(check, from, watched.reason);
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
        return store.receiveReview(checkId, reviewerThreadId, findings, { providerId: ran.providerId, model: ran.model }, now()) ? "recorded" : "not-running";
      });
    },
  };
}

/**
 * What a reviewer runs on: never the model of the agent whose work it reviews, nor, while bb runs
 * another there, the one the check's verifier is chosen on now, so the verifier's triage is
 * independent of it. The same order as a verifier's, with the verifier's model kept away from as
 * the agent's is; when bb runs nothing else, the verifier's model. null when bb runs nothing there
 * but the agent's own model: a review on it would be no independent review.
 */
async function reviewerExecution(bb: CatalogBb, choice: VerifierChoice): Promise<Execution | null> {
  const verifier = await verifierExecution(bb, choice);
  const reviewer = await verifierExecution(bb, { ...choice, named: null, theirs: [verifier, ...choice.theirs] });
  return choice.theirs.some((their) => sameModel(their, reviewer)) ? null : reviewer;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
