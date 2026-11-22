// Per-issue freshness. The store counts each issue's feed writes as they commit (migrations.ts
// issue_writes); this turns the counts that moved since it last looked into invalidations of those
// issues' tags, so an open tab reads again when its own issue changed and never for another's. No
// writer names a tag: a write is counted by the table it writes.
import { issueTag } from "../../contract.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

type Deps = { store: Pick<Store, "issueWrites">; invalidate(tags: string[]): void };

export function issueTagPublisher({ store, invalidate }: Deps) {
  /**
   * Each regional manager's counts as last published. why in memory: a reload starts empty, so its
   * first pass reads every open tab of the manager once more, as bb's reconnect does anyway.
   */
  const published = new Map<CoordinatorId, ReadonlyMap<IssueId, number>>();

  return {
    /** Invalidates the tags of the regional manager's issues written since the last call. */
    publish(coordinatorId: CoordinatorId): void {
      const now = store.issueWrites(coordinatorId);
      const before = published.get(coordinatorId);
      const moved = [...now].filter(([issueId, writes]) => before?.get(issueId) !== writes).map(([issueId]) => issueTag(coordinatorId, issueId));
      published.set(coordinatorId, now);
      if (moved.length > 0) invalidate(moved);
    },

    /** A regional manager removed: its counts go with it. */
    forget(coordinatorId: CoordinatorId): void {
      published.delete(coordinatorId);
    },
  };
}
