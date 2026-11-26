// An issue's feed as its tab reads it: what the tab shows beyond the issue's board row, and its
// entries; and the body of a round the reader opened. From the store, and bb's listing for which
// agents' threads can still be opened.
import type { IssueFeed } from "../../contract.ts";
import { feedOf } from "../../model/feed/feed.ts";
import { bodyOf, roundTarget, type RoundBody, type RoundKey } from "../../model/feed/round.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import type { Handed } from "../../model/issue/status.ts";
import { dependentsOf } from "../../model/issue/relations.ts";
import { filedWhen, type FiledWhen } from "../../model/verdict/rounds/follow-up.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { threadsById, type ListBb } from "../agents/threads.ts";
import type { Store } from "../store/store.ts";

type FeedStore = Pick<Store, "issue" | "issues" | "agents" | "record" | "finalChecks" | "issueDecisions" | "eventsOfIssue" | "logOf" | "commentsOf" | "handoff" | "check" | "originOf">;

export type FeedReader = ReturnType<typeof createFeedReader>;

export function createFeedReader(bb: ListBb<{ id: string; deletedAt: number | null }>, store: FeedStore) {
  /** The follow-ups the issue's passes or its accept filed: each one its record's checks name, once, with how (rounds/follow-up.ts filedWhen). why throw: an issue is kept while its regional manager is. */
  function followUpsOf(coordinatorId: CoordinatorId, handed: readonly Handed[]): (Issue & { when: FiledWhen })[] {
    const checks = handed.flatMap(({ check }) => (check === null ? [] : [check]));
    const ids = new Set(checks.flatMap(({ followUpId }) => (followUpId === null ? [] : [followUpId])));
    return [...ids].map((id) => {
      const followUp = store.issue(coordinatorId, id);
      if (followUp === null) throw new Error(`The follow-up ${id} of ${coordinatorId} is missing.`);
      return { ...followUp, when: filedWhen(checks, id) };
    });
  }

  return {
    /** The issue's feed, or null when the regional manager has no such issue. */
    async feed(coordinatorId: CoordinatorId, issueId: IssueId): Promise<IssueFeed | null> {
      const issue = store.issue(coordinatorId, issueId);
      if (issue === null) return null;
      // why every store read before the await: one response from one moment of the store, so an agent started meanwhile can't bring its round without itself.
      const agents = store.agents(coordinatorId).filter((agent) => agent.issueId === issueId);
      const handed = store.record(coordinatorId, issueId);
      const entries = feedOf({
        issue,
        agents,
        handed,
        finalChecks: store.finalChecks(coordinatorId, issueId),
        decisions: store.issueDecisions(coordinatorId, issueId),
        events: store.eventsOfIssue(coordinatorId, issueId),
        log: store.logOf(coordinatorId, issueId),
        comments: store.commentsOf(coordinatorId, issueId),
        followUps: followUpsOf(coordinatorId, handed),
        followUpOf: store.originOf(coordinatorId, issueId),
      });
      const blocks = dependentsOf(store.issues(coordinatorId), issueId);
      // why bb's listing, not how the agent ended: a thread archived or kept when its agent ended may be deleted since, and the agent's row never says so.
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      const openable = (threadId: string | null): string | null => (threadId !== null && threads.get(threadId)?.deletedAt === null ? threadId : null);
      return {
        description: issue.description,
        brief: issue.brief,
        doneCriteria: issue.doneCriteria,
        dependsOn: issue.dependsOn,
        blocks,
        agents: agents.map(({ id, threadId }) => ({ id, threadId: openable(threadId) })),
        entries,
      };
    },

    /** What a round of the issue opens to; null when the key names no round of it. */
    body(coordinatorId: CoordinatorId, issueId: IssueId, key: RoundKey): RoundBody | null {
      const target = roundTarget(key);
      switch (target.kind) {
        case "handoff": {
          const handed = store.handoff(target.handoffId);
          const ours = handed !== null && handed.handoff.coordinatorId === coordinatorId && handed.handoff.issueId === issueId;
          return ours ? bodyOf(handed.handoff, handed.check) : null;
        }
        case "final": {
          const check = store.check(target.checkId);
          const ours = check !== null && check.coordinatorId === coordinatorId && check.issueId === issueId && check.subject.kind === "final";
          return ours ? bodyOf(null, check) : null;
        }
        default:
          return target satisfies never;
      }
    },
  };
}
