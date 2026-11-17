import assert from "node:assert/strict";
import { test } from "node:test";
import { agentIdSchema } from "../../../model/agent.ts";
import type { PrSnapshot } from "../../../model/verdict/pr.ts";
import { failWrites, freshStore, MANAGER, newIssue, startAgent } from "../test-store.ts";

const pr = (over: Partial<PrSnapshot> = {}): PrSnapshot => ({ number: 12, url: "https://github.com/o/r/pull/12", state: "open", draft: false, review: "none", ci: "pending", headSha: "a".repeat(40), failedChecks: [], ...over });

test("a branch's pull request is one snapshot, whichever agent's read finds it, and each meaningful change is announced naming that agent", () => {
  const { store } = freshStore();
  const { id: issueId } = store.insertIssue(MANAGER, newIssue(), 2_000);
  const a1 = startAgent(store, issueId, "agent-1");
  const a2 = agentIdSchema.parse("a2");

  store.savePrRead(MANAGER, "bb/retries", { issueId, agentId: a1 }, pr(), null, 3_000);
  store.savePrRead(MANAGER, "bb/retries", { issueId, agentId: a2 }, pr(), null, 3_100);
  store.savePrRead(MANAGER, "bb/retries", { issueId, agentId: a2 }, pr({ state: "merged", ci: "pass" }), null, 3_200);

  assert.deepEqual(store.prOfBranch(MANAGER, "bb/retries"), { snapshot: pr({ state: "merged", ci: "pass" }), headSeenAt: 3_000, readAt: 3_200, handoffAtRead: null, unavailable: null, polledAt: 3_200 });
  assert.deepEqual(
    store.unannounced(MANAGER).map(({ event }) => event),
    [
      { kind: "pr", issueId, agentId: a1, pr: pr(), changes: ["opened"] },
      { kind: "pr", issueId, agentId: a2, pr: pr({ state: "merged", ci: "pass" }), changes: ["merged", "ci-passed"] },
    ],
  );
  assert.equal(store.prOfBranch(MANAGER, "bb/other"), null);
});

test("a failed read records why and keeps the snapshot; a read that finds none vouches for nothing and keeps it too", () => {
  const { store } = freshStore();
  const { id: issueId } = store.insertIssue(MANAGER, newIssue(), 2_000);
  const on = { issueId, agentId: startAgent(store, issueId, "agent-1") };
  store.savePrRead(MANAGER, "bb/retries", on, pr(), null, 3_000);

  store.markPrUnavailable(MANAGER, "bb/retries", { kind: "persistent", reason: "gh is not signed in" }, 3_100);
  assert.deepEqual(store.prOfBranch(MANAGER, "bb/retries"), { snapshot: pr(), headSeenAt: 3_000, readAt: 3_000, handoffAtRead: null, unavailable: { kind: "persistent", reason: "gh is not signed in" }, polledAt: 3_100 });

  store.savePrRead(MANAGER, "bb/retries", on, null, null, 3_200);
  assert.deepEqual(store.prOfBranch(MANAGER, "bb/retries"), { snapshot: pr(), headSeenAt: 3_000, readAt: 3_000, handoffAtRead: null, unavailable: null, polledAt: 3_200 });
});

test("a PR read whose change fails to be told keeps the snapshot as last read, and the same read retried tells it once", () => {
  const { db, store } = freshStore();
  const { id: issueId } = store.insertIssue(MANAGER, newIssue(), 2_000);
  const on = { issueId, agentId: startAgent(store, issueId, "agent-1") };
  store.savePrRead(MANAGER, "bb/retries", on, pr(), null, 3_000);
  const lastRead = store.prOfBranch(MANAGER, "bb/retries");
  const merged = pr({ state: "merged", ci: "pass" });

  const restore = failWrites(db, "INSERT", "events");
  assert.throws(() => store.savePrRead(MANAGER, "bb/retries", on, merged, null, 3_100), /forced failure/);
  assert.deepEqual(store.prOfBranch(MANAGER, "bb/retries"), lastRead);
  assert.deepEqual(store.unannounced(MANAGER).map(({ event }) => event), [{ kind: "pr", ...on, pr: pr(), changes: ["opened"] }]);

  restore();
  store.savePrRead(MANAGER, "bb/retries", on, merged, null, 3_100);
  assert.deepEqual(store.prOfBranch(MANAGER, "bb/retries"), { snapshot: merged, headSeenAt: 3_000, readAt: 3_100, handoffAtRead: null, unavailable: null, polledAt: 3_100 });
  assert.deepEqual(
    store.unannounced(MANAGER).map(({ event }) => event),
    [
      { kind: "pr", ...on, pr: pr(), changes: ["opened"] },
      { kind: "pr", ...on, pr: merged, changes: ["merged", "ci-passed"] },
    ],
  );
});
