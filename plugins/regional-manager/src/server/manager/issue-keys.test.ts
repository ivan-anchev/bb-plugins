import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoordinatorId } from "../../model/role.ts";
import { filedIssue, freshStore, MANAGER, newIssue } from "../store/test-store.ts";
import { keyIssuesOfEarlierManagers } from "./issue-keys.ts";

function earlierManager(projectName: () => string) {
  const { storage, store } = freshStore();
  storage.database().prepare("UPDATE coordinators SET issue_key = NULL WHERE id = ?").run(MANAGER);
  const warnings: string[] = [];
  const changed: CoordinatorId[] = [];
  const bb = { sdk: { projects: { get: async () => ({ name: projectName() }) } }, log: { warn: (message: string) => warnings.push(message) } };
  return { store, warnings, changed, keyIssues: keyIssuesOfEarlierManagers(bb, { store, onChange: (id) => changed.push(id) }) };
}

test("a regional manager started before issue keys takes its key from its project's name as it is now, and its board is refreshed", async () => {
  const { store, changed, keyIssues } = earlierManager(() => "bb-plugins");
  await keyIssues();
  assert.equal(filedIssue(store, MANAGER, newIssue(), 2_000).id, "BBP-1");
  assert.deepEqual(changed, [MANAGER]);

  await keyIssues();
  assert.deepEqual(changed, [MANAGER], "a later pass finds nothing to key");
});

test("a project bb can't read now leaves its manager unkeyed until a later pass reads it", async () => {
  let readable = false;
  const { store, warnings, changed, keyIssues } = earlierManager(() => {
    if (!readable) throw new Error("project not found");
    return "Acme Web App";
  });
  await keyIssues();
  assert.match(warnings.join("\n"), /Could not key the issues of the regional manager .* from its project prj_1; the next tick tries again: project not found/);
  assert.deepEqual(store.unkeyedManagers(), [{ id: MANAGER, projectId: "prj_1" }]);
  assert.deepEqual(changed, []);

  readable = true;
  await keyIssues();
  assert.equal(filedIssue(store, MANAGER, newIssue(), 2_000).id, "AWA-1");
});
