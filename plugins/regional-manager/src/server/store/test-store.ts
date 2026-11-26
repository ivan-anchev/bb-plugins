// Tests only: a fresh store with one regional manager whose thread is bound, and the steps most
// store tests take before what they test.
import type Database from "better-sqlite3";
import type { z } from "zod";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import { memoryStorage } from "../memory-storage.ts";
import { randomUUID } from "node:crypto";
import type { AgentId } from "../../model/agent/agent.ts";
import { handoffIdSchema } from "../../model/agent/handoff.ts";
import type { Check } from "../../model/verdict/check.ts";
import type { ReviewFinding, triageSchema } from "../../model/verdict/review.ts";
import type { Issue, IssueId, NewIssue } from "../../model/issue/issue.ts";
import { issueKeySchema } from "../../model/issue/key/issue-key.ts";
import type { Avatar } from "../../model/profile/avatar.ts";
import { coordinatorIdSchema, type CoordinatorId } from "../../model/role.ts";
import type { StoredEvent } from "../../model/inbox/inbox-event.ts";
import { openStore, type Store } from "./store.ts";

export const MANAGER = coordinatorIdSchema.parse("6f1c2a52-6b8e-4c43-9a51-1d6a3c0b7e10");
export const OTHER_MANAGER = coordinatorIdSchema.parse("9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d");

/** The avatar every test manager has unless the test is about avatars. */
export const AVATAR: Avatar = { kind: "blob", shape: "circle", hue: "purple", expression: "neutral" };

export const EXECUTION = { providerId: "codex", model: "gpt-5.4", reasoningLevel: "medium" };

export function freshStore() {
  const { db, storage } = memoryStorage();
  const store = openStore(storage);
  for (const [id, n] of [[MANAGER, 1], [OTHER_MANAGER, 2]] as const) {
    store.insertCoordinator({ id, ticket: `manager-${n}`, name: `Manager ${n}`, description: null, avatar: AVATAR, createdAt: 1_000 });
    store.startsOn(id, "prj_1", issueKeySchema.parse("WEB"));
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
  parentId: null,
  dependsOn: [],
  ...over,
});

/** Files the issue, as the store does, failing the test if it is refused. */
export function filedIssue(store: Store, coordinatorId: CoordinatorId, issue: NewIssue, at: number): Issue {
  const filed = store.insertIssue(coordinatorId, issue, new Map(), at);
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
 * Makes every `op` on `table` (or each row `when` names) fail until the returned function is called, as a full disk or a broken
 * row would. A write that fails after earlier ones of its transaction proves those were rolled back
 * with it; calling the function lets a test retry the same write.
 */
export function failWrites(db: Database.Database, op: "INSERT" | "UPDATE" | "DELETE", table: string, when = "1"): () => void {
  const trigger = `fail_${op}_${table}`;
  db.exec(`CREATE TRIGGER ${trigger} BEFORE ${op} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
  return () => db.exec(`DROP TRIGGER ${trigger}`);
}

/** Turns verification off for the regional manager without recording the switch, as for one that never verified. */
export function verifyOff(storage: Pick<PluginStorage, "database">, id: CoordinatorId): void {
  storage.database().prepare("UPDATE coordinators SET verify = 0 WHERE id = ?").run(id);
}

/** Makes the regional manager one 0.3.0 created: no name stored, and flagged as waiting for its goal unless `flagged` is false. */
export function heldAs030(storage: Pick<PluginStorage, "database">, id: CoordinatorId, flagged = true): void {
  storage.database().prepare("UPDATE coordinators SET awaiting_goal = ?, name = NULL WHERE id = ?").run(Number(flagged), id);
}

/** Every unread event of the regional manager, marked read at `at` once returned, as an answered catch-up marks them. */
export function takeUnread(store: Pick<Store, "unread" | "markRead">, coordinatorId: CoordinatorId, at: number = Date.now()): StoredEvent[] {
  const events = store.unread(coordinatorId);
  store.markRead(coordinatorId, events.map(({ id }) => id), at);
  return events;
}

/**
 * A done handoff of the agent on the issue, at commit `a…a`, whose reviewer reported one should-fix
 * that the verifier confirmed as every criterion passed, settled at `at`: a pass that files the
 * issue's follow-up. Its reviewer's and verifier's tickets are `reviewer-<n>` and `verifier-<n>` of
 * MANAGER, suffixed with the manager's id for any other, bound as `thr_` and the ticket.
 */
export const passWithShouldFix = (store: Store, issueId: IssueId, agentId: AgentId, n: number, at: number, coordinatorId = MANAGER): Check =>
  settledRound(store, { coordinatorId, issueId, agentId, n, at }, { title: "Log each retry", severity: "should-fix", claim: "Log each retry." }, { result: "confirmed", reason: "Nobody sees a retry." });

/**
 * A done handoff as passWithShouldFix makes one, whose reviewer reported one must-fix that the
 * verifier anchored to the brief as every criterion passed, settled at `at`: a failure on review
 * findings alone, which the manager may accept.
 */
export const failOnMustFix = (store: Store, issueId: IssueId, agentId: AgentId, n: number, at: number, coordinatorId = MANAGER): Check =>
  settledRound(store, { coordinatorId, issueId, agentId, n, at }, { title: "The backoff never caps", severity: "must-fix", claim: "The backoff never caps." }, { result: "anchored", anchor: "brief", steps: null, reason: "The brief says retries back off." });

/** A done handoff (the `n`th of the agent, at `at`) whose reviewer reported `finding` at `src/retry.ts:10`, triaged so as every criterion passed, settled as checked. */
function settledRound(
  store: Store,
  { coordinatorId, issueId, agentId, n, at }: { coordinatorId: CoordinatorId; issueId: IssueId; agentId: AgentId; n: number; at: number },
  finding: Pick<ReviewFinding, "title" | "severity" | "claim">,
  triage: z.infer<typeof triageSchema>,
): Check {
  const headSha = "a".repeat(40);
  const handoff = { id: handoffIdSchema.parse(randomUUID()), coordinatorId, issueId, agentId, at, turnSeq: n, summary: "Retries land", did: [], evidence: [], concerns: [], deviations: [], findings: [] };
  const check = store.insertHandoff({ ...handoff, status: "done", delivery: { kind: "commit", headSha, prUrl: null } }, { kind: "read", branch: null, checkout: { headSha, changedFiles: [], changedFileCount: 0 } }, null);
  if (check === null) throw new Error(`${issueId}'s done handoff made no check`);
  const on = { coordinatorId, issueId, checkId: check.id };
  const of = coordinatorId === MANAGER ? `${n}` : `${n}-${coordinatorId}`;
  store.insertCheckerTicket(`reviewer-${of}`, { kind: "reviewer", ...on }, at);
  store.bindTicket(`reviewer-${of}`, `thr_reviewer-${of}`);
  const model = { providerId: "codex", model: "gpt-default" };
  store.receiveReview(check.id, `thr_reviewer-${of}`, { findings: [{ file: "src/retry.ts", line: 10, origin: "new", ...finding }], earlier: [] }, model, at);
  store.insertCheckerTicket(`verifier-${of}`, { kind: "verifier", ...on }, at);
  store.bindTicket(`verifier-${of}`, `thr_verifier-${of}`);
  const criteria = [{ criterion: "npm test passes", result: "pass" as const, evidence: "ok" }];
  store.receiveVerdict(check.id, { state: "returned", verifierThreadId: `thr_verifier-${of}`, headSha, checkout: { headSha, changedFiles: [], changedFileCount: 0 }, criteria, blocking: [], findings: [], triage: [triage], model, sameModel: false }, at);
  if (store.settleReturned(check.id, { kind: "checked", refused: null, ci: { kind: "none" } }, at, null) === null) throw new Error(`${issueId}'s round didn't settle`);
  return check;
}

/** MANAGER's rows as a release before issue keys wrote them: every WEB-N it stores, as data or in text, is iN, and it has no key. */
export function asBeforeKeys(db: Database.Database): void {
  db.transaction(() => {
    db.pragma("defer_foreign_keys = ON");
    for (const { name: table } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_bb_migrations'").all() as { name: string }[]) {
      const columns = (db.pragma(`table_info(${table})`) as { name: string }[]).map(({ name }) => name);
      const mine = columns.includes("coordinator_id") ? "coordinator_id = @id" : table === "roles" ? "json_extract(role, '$.coordinatorId') = @id" : null;
      // why skipped: issue_writes came after issue keys, and the renames count their writes under the i-style ids already.
      if (mine === null || table === "issue_writes") continue;
      for (const column of columns) db.prepare(`UPDATE ${table} SET ${column} = replace(${column}, 'WEB-', 'i') WHERE ${mine} AND typeof(${column}) = 'text'`).run({ id: MANAGER });
    }
    db.prepare("DELETE FROM issue_writes WHERE coordinator_id = ? AND issue_id GLOB 'WEB-*'").run(MANAGER);
    db.prepare("UPDATE coordinators SET issue_key = NULL WHERE id = ?").run(MANAGER);
  })();
}
