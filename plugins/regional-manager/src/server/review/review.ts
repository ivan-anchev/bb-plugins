// The review stage: before a done handoff's verifier starts, the plugin starts a hidden reviewer in
// the agent's environment, on the reviewer named on its issue, or else on a model other than the
// agent's and, when bb runs one, other than the one its verifier will run on, so the verifier's
// triage of its findings is independent. Its first
// message is the diff, the issue's brief and done-criteria, and CREW.md (reviewer-brief.ts); what
// it runs is CREW.md's. It reports through issue_review (review-tool.ts). A review never holds an
// issue up: a reviewer bb won't start, or that is gone, idle without findings, stalled, or asking
// what bb won't let the plugin decline, ends the review as missed, and verification goes ahead,
// its verdict saying no review was had. The verify step calls start and follow in the issue's turn
// (verify.ts reviewInTurn), which owns when the environment changes hands.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { sameModel, type Execution } from "../../model/agent/execution.ts";
import type { HandoffCheck, CheckId } from "../../model/verdict/check.ts";
import { numberedText } from "../../model/verdict/review.ts";
import { unfixed } from "../../model/verdict/rounds/delta.ts";
import type { AgentId } from "../../model/agent/agent.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { handingAgent } from "../agents/handing-agent.ts";
import { isRunning, listedThreads, stopThreads, type StopBb } from "../agents/threads.ts";
import { resolvedExecution, type CatalogBb } from "../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../execution/thread-execution.ts";
import type { Busy, IssueTurns } from "../issues/issue-turns.ts";
import { CREW_FILE, type MemoryRoot } from "../memory/memory-files.ts";
import type { CheckerRequest, Spawner } from "../spawn.ts";
import type { ReviewFrom, ReviewReport } from "../store/issue/checks-store.ts";
import type { Store } from "../store/store.ts";
import type { AsksBb } from "../hidden/asks.ts";
import { verifierExecution, type VerifierChoice } from "../verify/verifier-model.ts";
import { watchHidden, type ActivityBb } from "../hidden/watch.ts";
import { numbersRefusal } from "../tools/tool-kit.ts";
import { checkedIssue, scopeOf, type Scope } from "./checker-brief.ts";
import type { ReviewInput } from "./review-tool.ts";
import { reviewerBrief, scopeParts } from "./reviewer-brief.ts";

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
  store: Pick<Store, "check" | "agent" | "issue" | "coordinator" | "issueDecisions" | "record" | "finalChecks" | "missReview" | "receiveReview" | "rescopeReview">;
  spawner: Pick<Spawner, "checker">;
  memory: MemoryRoot;
  turns: IssueTurns;
  now(): number;
};

/** What became of a reviewer's findings: stored; refused, as its review no longer waits for them; or refused for why they can't be taken (`refused`). */
type Received = "recorded" | "not-running" | { refused: string };

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
      reviewerExecution(bb, { named: check.reviewer, issueId: check.issueId, agentId: agent.id }, { named: check.verifier, manager: await threadExecution(bb, coordinator.threadId), theirs: [agent.execution], routing: { environmentId } }),
      bb.sdk.environments.get({ environmentId }),
    ]);
    if ("none" in execution) return execution;
    // why read here, after every await: the brief and the decisions it gives must agree (checkedIssue).
    const issue = checkedIssue(store, check.coordinatorId, check.issueId);
    return {
      role: { kind: "reviewer", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id } as const,
      coordinator,
      parentThreadId: agent.threadId,
      title: `Review ${issue.id}: ${issue.title}`,
      environment: { type: "reuse", environmentId } as const,
      execution,
      prompt: reviewerBrief({ ...issue, doneCriteria: check.criteria }, { ...check.subject, defaultBranch }, scopeOf(store, check), memory.of(check.coordinatorId).read(CREW_FILE).text),
    };
  }

  /** Whether the check's running reviewer `reviewerThreadId` was given its review's scope, read now; true for any other review, which reported will refuse as not running. */
  function givenScope(checkId: CheckId, reviewerThreadId: string): boolean {
    const review = store.check(checkId)?.review;
    return review?.state !== "running" || review.reviewerThreadId !== reviewerThreadId || review.scoped;
  }

  /**
   * A later round's report from a reviewer whose first message predates scopes, so asked for the
   * whole diff: refused once, with the scope it reviews in its place (reviewer-brief.ts
   * scopeParts), and the reviewer marked as given it, so its next report is taken. why refused
   * whatever it holds, no blocking findings to answer included: a whole-diff report stored as a
   * later round's would mark findings on code an earlier round passed as new.
   */
  async function rescoped(check: HandoffCheck, reviewerThreadId: string, scope: Extract<Scope, { kind: "after" }>): Promise<Received> {
    const agent = handingAgent(store, check);
    const environmentId = (await listedThreads(bb, [agent.threadId])).get(agent.threadId)?.environmentId ?? null;
    const defaultBranch = environmentId === null ? null : (await bb.sdk.environments.get({ environmentId })).defaultBranch;
    if (!store.rescopeReview(check.id, reviewerThreadId)) return "not-running";
    const parts = scopeParts({ ...check.subject, defaultBranch }, scope).join("\n\n");
    return { refused: `your first message, written before later rounds were reviewed by their change alone, asked for the whole diff, and this is a later round. Review this instead:\n\n${parts}` };
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
     * In its issue's turn: stores a reviewer's report on its check, if it is still that check's
     * running reviewer and the check still waits for its verifier, with the model bb ran it on: its
     * findings, each earlier blocking finding it answered not fixed among them as unfixed, and its
     * answers, read against the check's scope (reportOf); on a later round, from a reviewer told
     * only the whole diff, refused once with that scope (rescoped). Its verifier starts once bb reports the
     * reviewer idle (verify.ts lookAgain), or at the next tick.
     */
    reported(checkId: CheckId, reviewerThreadId: string, input: ReviewInput): Promise<Received | Busy> {
      const check = store.check(checkId);
      // why throw: a reviewer is started for a check, and checks are kept while their regional manager is.
      if (check?.subject.kind !== "handoff") throw new Error(`The check ${checkId} of a done handoff is missing.`);
      const { subject } = check;
      return turns.run(check.coordinatorId, check.issueId, async () => {
        const scope = scopeOf(store, { ...check, subject });
        if (scope.kind === "after" && !givenScope(checkId, reviewerThreadId)) return rescoped({ ...check, subject }, reviewerThreadId, scope);
        const report = reportOf(input, scope);
        if (typeof report === "string") return { refused: report };
        const ran = await threadExecution(bb, reviewerThreadId);
        // why throw: the reviewer calls issue_review from inside a turn, so bb has its model on record.
        if (ran === null) throw new Error(`bb has no model on record for ${reviewerThreadId}.`);
        return store.receiveReview(checkId, reviewerThreadId, report, { providerId: ran.providerId, model: ran.model }, now()) ? "recorded" : "not-running";
      });
    },
  };
}

/**
 * What a reviewer runs on: the reviewer named on its issue (`named`), as named, whatever model the
 * agent or the verifier runs on: the manager's call. When bb can't run it where the review runs,
 * none, saying so with what bb can run there, as any execution is refused. With none named, the
 * plugin's pick: never the model of the agent whose work it reviews, nor, while bb runs another
 * there, the one the check's verifier is chosen on now, so the verifier's triage is independent of
 * it. The same order as a verifier's, with the verifier's model kept away from as the agent's is;
 * when bb runs nothing else, the verifier's model; none when bb runs nothing there but the agent's
 * own model, as a review it picks on that would be no independent review.
 */
async function reviewerExecution(
  bb: CatalogBb,
  { named, issueId, agentId }: { named: Execution | null; issueId: IssueId; agentId: AgentId },
  choice: VerifierChoice,
): Promise<Execution | { none: string }> {
  if (named !== null) {
    const resolved = await resolvedExecution(bb, choice.routing, named);
    // why the stop dropped: the reason is read inside a sentence (inbox-text.ts reviewText, verifier-brief.ts).
    return "refused" in resolved ? { none: `bb can't run the ${named.providerId} ${named.model} named on ${issueId} as its reviewer in ${agentId}'s environment: ${resolved.refused.replace(/\.$/, "")}` } : resolved;
  }
  const verifier = await verifierExecution(bb, choice);
  const reviewer = await verifierExecution(bb, { ...choice, named: null, theirs: [verifier, ...choice.theirs] });
  return choice.theirs.some((their) => sameModel(their, reviewer)) ? { none: `no independent reviewer model: bb can run none there but ${agentId}'s own` } : reviewer;
}

/**
 * A reviewer's report as its check stores it, or why it can't be taken: on a first round, every
 * finding new and no earlier answers; after a reviewed round, each of its blocking findings
 * answered once, by its number. Each answered not fixed joins the findings as unfixed, first, in
 * the blocking findings' order. A refusal of the answers says what this review covers and lists
 * the blocking findings, so a reviewer whose first message said otherwise, as one started before
 * this release, can correct its report.
 */
function reportOf({ findings, earlier }: ReviewInput, scope: Scope): ReviewReport | string {
  const blocking = scope.kind === "after" ? scope.blocking : [];
  if (scope.kind === "first" && findings.some(({ origin }) => origin === "missed")) return `no earlier round qualifies as the review base, so none reviewed any of this code: mark every finding new.`;
  const refused = numbersRefusal(
    earlier.map(({ finding }) => finding),
    blocking.length,
    { verb: "answer", each: "earlier blocking finding", all: "earlier blocking findings" },
  );
  if (refused !== null) return `${refused} ${scopeText(scope)}`;
  const answered = blocking.map((finding, i) => ({ finding, answer: answerTo(earlier, i + 1) }));
  const carried = answered.filter(({ answer }) => !answer.fixed).map(({ finding }) => unfixed(finding));
  return { findings: [...carried, ...findings], earlier: answered.map(({ answer }) => answer) };
}

/** What this review covers, and on a later round the blocking findings it answers, by number. */
function scopeText(scope: Scope): string {
  if (scope.kind === "first") return "No earlier round qualifies as the review base: this review covers the whole diff, with nothing earlier to answer.";
  const blocking = scope.blocking.length === 0 ? "None of its findings failed its verdict." : `Its blocking findings, by number:\n\n${numberedText(scope.blocking)}`;
  return `This review covers only the change since round ${scope.round}, the last round reviewed, at \`${scope.base.subject.headSha}\`. ${blocking}`;
}

/** The answer to the earlier blocking finding `number`. why throw: numbersRefusal refused a report that skips one. */
function answerTo(earlier: ReviewInput["earlier"], number: number): ReviewReport["earlier"][number] {
  const answer = earlier.find(({ finding }) => finding === number);
  if (answer === undefined) throw new Error(`Earlier blocking finding ${number} has no answer.`);
  return { fixed: answer.fixed, note: answer.note };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
