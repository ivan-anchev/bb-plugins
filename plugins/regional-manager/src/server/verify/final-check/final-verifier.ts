// A final check's verifier: where it runs and on what, and the tree it judged. It is a hidden child
// of the regional manager's thread in a fresh managed worktree of the default branch the check
// recorded, on the manager's machine. It is asked for as `origin/<branch>`, which bb fetches and
// starts at origin's tip even when the local branch is behind (bb-facts P2, P4), after the merges
// that made the check due were seen. why named, never bb's default: bb resolves its default when it
// provisions, which may be another branch than the one the check recorded and every text names. It
// shares that worktree with nobody, and the commit judged is the one it holds when it returns.
import type { Coordinator } from "../../../contract.ts";
import { environmentOf } from "../../../model/agent/agent.ts";
import { catalogRouting, type Execution } from "../../../model/agent/execution.ts";
import type { Issue } from "../../../model/issue/issue.ts";
import type { FinalCheck } from "../../../model/verdict/check.ts";
import type { CheckoutRead } from "../../../model/verdict/checkout.ts";
import type { BlockingDefect } from "../../../model/verdict/review.ts";
import { listedThreads, type ListBb } from "../../agents/threads.ts";
import type { CatalogBb } from "../../execution/catalog.ts";
import { threadExecution, type ThreadExecutionBb } from "../../execution/thread-execution.ts";
import { checkoutReadOf, gitStatusOf, type GitStatusBb } from "../../git-status.ts";
import type { CheckerRequest } from "../../spawn.ts";
import { finalCheckBrief } from "../verifier-brief.ts";
import { verifierExecution } from "../verifier-model.ts";

type ListedThread = { id: string; environmentId: string | null; environmentHostId: string | null; archivedAt: number | null; deletedAt: number | null };

/** The parts of bb a final check's verifier needs: the manager's thread, bb's catalog there, the verifier's thread and its worktree's git status. */
export type FinalVerifierBb = ListBb<ListedThread> & CatalogBb & ThreadExecutionBb & GitStatusBb;

/**
 * Everything the verifier of a final check needs, with the blocking defects an earlier final
 * check's verifier found (`earlier`) for it to answer. It runs on the parent's named verifier when
 * bb lists it on the manager's machine and no agent whose work it checks (`theirs`) ran on it,
 * else as verifierExecution picks.
 */
export async function finalCheckerRequest(
  bb: FinalVerifierBb,
  { check, coordinator, issue, theirs, earlier }: { check: FinalCheck; coordinator: Coordinator; issue: Issue; theirs: Execution[]; earlier: readonly BlockingDefect[] },
): Promise<CheckerRequest> {
  const manager = (await listedThreads<ListedThread>(bb, [coordinator.threadId])).get(coordinator.threadId);
  if (manager === undefined) throw new Error("the regional manager's thread was archived or deleted");
  const environment = environmentOf({ kind: "worktree" }, manager.environmentHostId, `origin/${check.subject.defaultBranch}`);
  const execution = await verifierExecution(bb, { named: check.verifier, manager: await threadExecution(bb, coordinator.threadId), theirs, routing: catalogRouting(environment) });
  return {
    role: { kind: "verifier", coordinatorId: coordinator.id, issueId: issue.id, checkId: check.id },
    coordinator,
    parentThreadId: coordinator.threadId,
    title: `Final check of ${issue.id}: ${issue.title}`,
    environment,
    execution,
    prompt: finalCheckBrief(issue, check, earlier),
  };
}

/** The verifier's own worktree as bb's git plugin reads it now: the commit it judged and its tree, or why it can't say. */
export async function judgedTree(bb: FinalVerifierBb, verifierThreadId: string): Promise<CheckoutRead> {
  const environmentId = (await listedThreads<ListedThread>(bb, [verifierThreadId])).get(verifierThreadId)?.environmentId ?? null;
  if (environmentId === null) return { kind: "unread", reason: "its thread has no environment" };
  return checkoutReadOf(await gitStatusOf(bb, environmentId));
}
