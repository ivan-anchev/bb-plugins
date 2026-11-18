// The final check of a build parent: once every sub-issue is closed and every Done build sub-issue's
// work is merged, an independent verifier checks the parent's own done-criteria on the default
// branch (final-verifier.ts). Which parents are due is status.ts's (finalCheckPlaces). The tick is
// the one trigger, because "merged" is learned only there (pr-watch.ts): a merge read this tick
// makes its parent's check this tick, and a manager's accept or cancel is seen within a minute.
//
// why the parent's turn and views current as the check is written: a final check belongs to the
// parent, so making it, superseding the one still open and starting its verifier are the parent's
// turn's (issue-turns.ts), and so is its verdict. What makes a check due is the sub-issues', which
// change in their own turns and in the manager's writes, so the parent's turn alone can't hold them
// still: the check is written only on views no write or thread move overtook (current-views.ts),
// in the same step as the check that they are current. That is the compare-and-set: a second tick
// sees the check the first made, and a sub-issue filed meanwhile is a write that sends the read
// round again, so neither leaves two open final checks.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { IssueId } from "../../../model/issue/issue.ts";
import { isVerified } from "../../../model/issue/kind.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { IssueTurns } from "../../issues/issue-turns.ts";
import type { CurrentViews } from "../../issues/views/current-views.ts";
import { readIssues, type FactsBb, type FactsStore } from "../../issues/views/issue-facts.ts";
import type { Store } from "../../store/store.ts";
import type { Verify } from "../verify.ts";

type Deps = {
  bb: FactsBb & { log: Pick<PluginLogger, "warn"> };
  store: FactsStore & Pick<Store, "coordinators" | "insertFinalCheck">;
  views: Pick<CurrentViews, "whileCurrent">;
  turns: IssueTurns;
  verify: Pick<Verify, "startInTurn">;
  /** The project's default branch as bb records it (environments.ts); null when it records none. */
  defaultBranch(id: CoordinatorId): Promise<string | null>;
  now(): number;
};

export function createFinalChecks({ bb, store, views, turns, verify, defaultBranch, now }: Deps) {
  /**
   * In the parent's turn: makes its final check on `defaultBranch` while the parent's view, current
   * as it is written, says one is due, and starts its verifier while it is queued for one.
   */
  async function checkInTurn(coordinatorId: CoordinatorId, parentId: IssueId, defaultBranch: string): Promise<void> {
    const made = await views.whileCurrent(coordinatorId, (current) => {
      const merged = current.find(({ issue }) => issue.id === parentId)?.finalCheckDue ?? null;
      return merged === null ? null : store.insertFinalCheck(coordinatorId, parentId, { defaultBranch, merged }, now());
    });
    const check = made?.acted ?? null;
    if (check?.verdict.state === "queued") await verify.startInTurn(check);
  }

  /** Whether the manager has a build parent it hasn't closed, the only issue that can have a final check due. why asked first: most managers have none, and then nothing of bb is read. */
  const hasOpenBuildParent = (coordinatorId: CoordinatorId): boolean => {
    const issues = store.issues(coordinatorId);
    return issues.some(({ id, kind, closed }) => closed === null && isVerified(kind) && issues.some(({ parentId }) => parentId === id));
  };

  return {
    /**
     * The tick's pass, after the PR watch's reads and before the verifiers': for each build parent
     * whose final check is due, a turn of the parent that makes it and starts its verifier. With no
     * default branch on record, nothing is made, and the parent stays "Final check due". why it
     * never waits for the turns: as verify.ts reconcile.
     */
    async tick(): Promise<void> {
      for (const { id } of store.coordinators()) {
        if (!hasOpenBuildParent(id)) continue;
        const due = (await readIssues(bb, store, id)).flatMap(({ view }) => (view.finalCheckDue === null ? [] : [view.issue.id]));
        if (due.length === 0) continue;
        const branch = await defaultBranch(id);
        if (branch === null) continue;
        for (const parentId of due) {
          turns
            .runIfFree(id, parentId, () => checkInTurn(id, parentId, branch))
            .catch((error: unknown) => bb.log.warn(`Could not make the final check of ${parentId}; the next tick tries again: ${messageOf(error)}`));
        }
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
