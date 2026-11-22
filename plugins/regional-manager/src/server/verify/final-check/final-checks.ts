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
  async function checkInTurn(coordinatorId: CoordinatorId, parentId: IssueId, defaultBranch: string): Promise<void> {
    const made = await views.whileCurrent(coordinatorId, (current) => {
      const merged = current.find(({ issue }) => issue.id === parentId)?.finalCheckDue ?? null;
      return merged === null ? null : store.insertFinalCheck(coordinatorId, parentId, { defaultBranch, merged }, now());
    });
    const check = made?.acted ?? null;
    if (check?.verdict.state === "queued") await verify.startInTurn(check);
  }

  const hasOpenBuildParent = (coordinatorId: CoordinatorId): boolean => {
    const issues = store.issues(coordinatorId);
    return issues.some(({ id, kind, closed }) => closed === null && isVerified(kind) && issues.some(({ parentId }) => parentId === id));
  };

  return {
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
