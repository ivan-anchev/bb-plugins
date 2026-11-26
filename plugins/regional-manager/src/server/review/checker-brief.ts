// What a reviewer's and a verifier's first messages share, and their tools: the issue they are
// written from, read with its decisions in one read, those decisions as the section each gives
// them, and the check's scope, the change its review covers.
import { decisionsText, type IssueDecision } from "../../model/decision.ts";
import { numberedRounds } from "../../model/feed/feed.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Check, HandoffCheck } from "../../model/verdict/check.ts";
import type { BlockingDefect } from "../../model/verdict/review.ts";
import { deltaOf, type Delta } from "../../model/verdict/rounds/delta.ts";
import type { Store } from "../store/store.ts";

/** What a check's review covers (rounds/delta.ts Delta), with, after a reviewed round, that round's number as the issue's tab shows it. */
export type Scope = Extract<Delta, { kind: "first" }> | (Extract<Delta, { kind: "after" }> & { round: number });

/**
 * The scope of a check of a done handoff: the delta of the issue's checks before it, every agent's,
 * and its base's round number by the feed's numbering. why throw: a check is inserted with its
 * handoff, and a base is one of the issue's rounds.
 */
export function scopeOf(store: Pick<Store, "record" | "finalChecks">, check: HandoffCheck): Scope {
  const record = store.record(check.coordinatorId, check.issueId);
  const delta = deltaOf(earlierChecks(record, check));
  if (delta.kind === "first") return delta;
  const base = numberedRounds(record, store.finalChecks(check.coordinatorId, check.issueId)).find((round) => round.kind === "handoff" && round.handed.check?.id === delta.base.id);
  if (base === undefined) throw new Error(`The base of check ${check.id} is not one of ${check.issueId}'s rounds.`);
  return { ...delta, round: base.number };
}

/**
 * The blocking defects the latest earlier verifier of the same kind of check found itself
 * (verdict.ts `blocking`), for this check's verifier to answer fixed or still blocking, so a known
 * defect stays until a verifier sees it fixed: a handoff's, from the issue's earlier handoffs'
 * checks; a final check's, from the parent's earlier final checks. why the latest returned verdict
 * only: each verdict carries the earlier defects its verifier answered still blocking, so it holds
 * every one still open.
 */
export function earlierDefectsOf(store: Pick<Store, "record" | "finalChecks">, check: Check): BlockingDefect[] {
  const returned = earlierOfKind(store, check).flatMap(({ verdict }) => (verdict.state === "returned" ? [verdict] : []));
  return returned.at(-1)?.blocking ?? [];
}

/** The issue's checks of the same kind as `check` made before it, oldest first. why throw: a final check is read from its issue's final checks. */
function earlierOfKind(store: Pick<Store, "record" | "finalChecks">, check: Check): Check[] {
  const { subject } = check;
  switch (subject.kind) {
    case "handoff":
      return earlierChecks(store.record(check.coordinatorId, check.issueId), { ...check, subject });
    case "final": {
      const finals = store.finalChecks(check.coordinatorId, check.issueId);
      const at = finals.findIndex(({ id }) => id === check.id);
      if (at === -1) throw new Error(`The final check ${check.id} is not one of ${check.issueId}'s.`);
      return finals.slice(0, at);
    }
    default:
      return subject satisfies never;
  }
}

/** The checks of the issue's handoffs before the one `check` judges, oldest first. why throw: a check is inserted with its handoff. */
function earlierChecks(record: ReturnType<Store["record"]>, check: HandoffCheck): Check[] {
  const at = record.findIndex(({ handoff }) => handoff.id === check.subject.handoffId);
  if (at === -1) throw new Error(`The handoff of check ${check.id} is not on ${check.issueId}'s record.`);
  return record.slice(0, at).flatMap(({ check: earlier }) => (earlier === null ? [] : [earlier]));
}

/** An issue as a reviewer's or a verifier's first message gives it: its brief, and its decisions. */
type CheckedIssue = Issue & { brief: string; decisions: IssueDecision[] };

/**
 * The issue a checker's first message is written from, with its decisions, in one read. why one
 * synchronous read, after any await: an issue_update can change the brief and record a decision
 * together, and the two must agree in the message. why throw: a checker starts only for a check of
 * an issue that had a brief for its agent, and checks are kept while their issue is.
 */
export function checkedIssue(store: Pick<Store, "issue" | "issueDecisions">, coordinatorId: CoordinatorId, issueId: IssueId): CheckedIssue {
  const issue = store.issue(coordinatorId, issueId);
  if (issue === null || issue.brief === null) throw new Error(`The issue ${issueId} of ${coordinatorId}, or its brief, is missing.`);
  return { ...issue, brief: issue.brief, decisions: store.issueDecisions(coordinatorId, issueId) };
}

/**
 * What the user and the regional manager decided about the issue, as a reviewer's and a
 * verifier's first message give it: the decisions agents get (decision.ts decisionsText), less the
 * plugin's own questions at the issue's cap, whose answer allows a round and decides nothing about
 * the work. Nothing when that leaves none.
 */
export function decisionsPart(issueId: Issue["id"], decisions: readonly IssueDecision[]): string[] {
  const about = decisions.filter((decision) => decision.kind === "recorded" || decision.cap === null);
  if (about.length === 0) return [];
  return [`## Decisions on ${issueId}\n\nWhat the user and the regional manager decided about this issue: the decisions recorded on it, and the user's answers to the questions put to them. They are part of the work, as its brief is: work that follows one is never a finding, and a must-fix that breaks one breaks a recorded decision. A question not answered yet decides nothing.\n\n${decisionsText(about)}`];
}
