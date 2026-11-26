import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import { issueKeySchema } from "../../model/issue/key/issue-key.ts";
import { filedIssue, freshStore, MANAGER, newIssue, OTHER_MANAGER, startAgent } from "../store/test-store.ts";
import { issueTagPublisher } from "./issue-tags.ts";

test("a write to BBP-19 invalidates BBP-19's tag alone, once; a pass with nothing written invalidates nothing; a manager forgotten is published whole again", () => {
  const { store } = freshStore();
  store.startsOn(MANAGER, "prj_1", issueKeySchema.parse("BBP"));
  const issues = Array.from({ length: 19 }, (_, i) => filedIssue(store, MANAGER, newIssue({ title: `Issue ${i + 1}` }), 2_000).id);
  const bbp19 = issues[18] ?? assert.fail();
  filedIssue(store, OTHER_MANAGER, newIssue(), 2_000);
  const invalidated: string[][] = [];
  const tags = issueTagPublisher({ store, invalidate: (moved) => invalidated.push(moved) });

  tags.publish(MANAGER);
  assert.equal(invalidated.at(-1)?.length, 19, "the first pass publishes every issue it has counts for");
  const agentId = startAgent(store, bbp19, "agent-1");
  tags.publish(MANAGER);
  invalidated.length = 0;

  const report = { summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  store.insertHandoff({ id: handoffIdSchema.parse(randomUUID()), coordinatorId: MANAGER, issueId: bbp19, agentId, at: 3_000, turnSeq: 1, ...report, status: "blocked" }, { kind: "unread", reason: "unused" }, null);
  tags.publish(MANAGER);
  assert.deepEqual(invalidated, [[`issue:${MANAGER}/BBP-19`]]);

  tags.publish(MANAGER);
  filedIssue(store, OTHER_MANAGER, newIssue(), 3_000);
  tags.publish(MANAGER);
  assert.deepEqual(invalidated, [[`issue:${MANAGER}/BBP-19`]], "nothing written since, or only another manager's");

  tags.forget(MANAGER);
  tags.publish(MANAGER);
  assert.equal(invalidated.at(-1)?.length, 19);
});
