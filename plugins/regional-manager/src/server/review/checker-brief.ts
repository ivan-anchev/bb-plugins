// What a reviewer's and a verifier's first messages share: the issue they are written from, read
// with its decisions in one read, and those decisions as the section each gives them.
import { decisionsText, type IssueDecision } from "../../model/decision.ts";
import type { Issue, IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";

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
