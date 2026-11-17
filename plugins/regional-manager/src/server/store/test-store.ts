// Tests only: a fresh store with one regional manager whose thread is bound, and the steps most
// store tests take before what they test.
import type Database from "better-sqlite3";
import { memoryStorage } from "../memory-storage.ts";
import type { AgentId } from "../../model/agent.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import { openStore, type Store } from "./store.ts";
import type { NewIssue } from "./issue/issues-store.ts";

export const MANAGER = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
export const OTHER_MANAGER = coordinatorIdSchema.parse("9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d");

export const EXECUTION = { providerId: "codex", model: "gpt-5.4", reasoningLevel: "medium" };

export function freshStore() {
  const { db, storage } = memoryStorage();
  const store = openStore(storage);
  for (const [id, n] of [[MANAGER, 1], [OTHER_MANAGER, 2]] as const) {
    store.insertCoordinator({ id, ticket: `manager-${n}`, projectId: "prj_1", verify: true, createdAt: 1_000 });
    store.bindTicket(`manager-${n}`, `thr_manager_${n}`);
  }
  return { db, storage, store };
}

export const newIssue = (over: Partial<NewIssue> = {}): NewIssue => ({
  kind: "build",
  title: "Add retries",
  description: "Failed webhook deliveries are lost.",
  brief: "Retry failed deliveries with backoff.",
  doneCriteria: ["npm test passes"],
  verifier: null,
  rest: "todo",
  dependsOn: [],
  ...over,
});

/** Files the issue, as the store does, failing the test if it is refused. */
export function filedIssue(store: Store, coordinatorId: CoordinatorId, issue: NewIssue, at: number): Issue {
  const filed = store.insertIssue(coordinatorId, issue, at);
  if ("refused" in filed) throw new Error(filed.refused);
  return filed.issue;
}

/** An agent started on the issue, its thread bound as `thr_<ticket>`. */
export function startAgent(store: Store, issueId: IssueId, ticket: string, coordinatorId = MANAGER): AgentId {
  const id = store.insertAgent({ coordinatorId, issueId, ticket, placement: { kind: "worktree" }, base: { kind: "default" }, checkout: { environmentId: null, branch: null, head: null }, execution: EXECUTION, at: 2_000 });
  if (id === null) throw new Error(`${issueId} already has an agent`);
  store.bindTicket(ticket, `thr_${ticket}`);
  return id;
}

/**
 * Makes every `op` on `table` fail until the returned function is called, as a full disk or a broken
 * row would. A write that fails after earlier ones of its transaction proves those were rolled back
 * with it; calling the function lets a test retry the same write.
 */
export function failWrites(db: Database.Database, op: "INSERT" | "UPDATE", table: string): () => void {
  const trigger = `fail_${op}_${table}`;
  db.exec(`CREATE TRIGGER ${trigger} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
  return () => db.exec(`DROP TRIGGER ${trigger}`);
}
