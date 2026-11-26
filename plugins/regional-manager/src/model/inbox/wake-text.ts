// The doorbell: the short message that wakes a regional manager. It is sent agent-only, so bb shows
// the user no message for it, only the turn it starts. The model still reads it as a user-role
// message, so it holds only facts the plugin derived (an issue's and an agent's id, a
// handoff's status, a memory file's name) and text the regional manager itself wrote: the titles it
// gave its issues, the notes of its reminders and the questions it asked the user. Anything an agent
// or a verifier wrote, and the user's answers, are read through crew_catch_up, as a tool result,
// never here; but for an answer at an issue's cap, the choice it makes, in the plugin's own words.
import type { AgentId } from "../agent/agent.ts";
import type { Decision, DecisionId } from "../decision.ts";
import type { IssueId } from "../issue/issue.ts";
import type { Check, CheckId } from "../verdict/check.ts";
import { capChoice, choicePhrase } from "../verdict/rounds/cap-choice.ts";
import { askedQuestion, askedText, isCapQuestion, type CapQuestion } from "../verdict/rounds/cap.ts";
import { PR_CHANGE_WORDS, prName } from "../verdict/pr.ts";
import { ciVerdictOf, failurePhrases, failureReasons, mayHaveReachedAgent, outcome } from "../verdict/verdict.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";
import { filesText } from "./own-tree.ts";

type Lookups = {
  /** Each issue's title, as the regional manager gave it. */
  titles: ReadonlyMap<IssueId, string>;
  check(id: CheckId): Check | null;
  decision(id: DecisionId): Decision | null;
};

export function doorbellText(events: readonly StoredEvent[], lookups: Lookups): string {
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  const lines = events.map(({ event }) => `- ${line(event, lookups)}`);
  return [`[${DISPLAY_NAME}] ${count}. Call crew_catch_up to read ${events.length === 1 ? "it" : "them"} in full.`, ...lines].join("\n");
}

function line(event: InboxEvent, lookups: Lookups): string {
  const { titles, check, decision } = lookups;
  if (event.kind === "memory-edited") return `The user edited ${event.file}`;
  if (event.kind === "verification-toggled") return `The user turned verification of done handoffs ${event.verify ? "on" : "off"}`;
  if (event.kind === "reminder") return `Your reminder ${event.reminderId}: ${event.note}`;
  if (event.kind === "decision-answered") return answeredLine(askedOf(decision(event.decisionId)));
  if (event.kind === "coordinator-edited-files") return `Your own environment has ${filesText(event.fileCount)} changed after your turn: hand the change to an agent`;
  if (event.kind === "coordinator-tree-clean") return "Your own environment is clean again";
  if (event.kind === "checked") return checkedLine(checkedOf(check(event.checkId)), event.asked === null ? null : askedQuestion(decision(event.asked)), titles);
  if (event.kind === "unblocked") return `${titled(event.issueId, titles)} is unblocked: ${event.by} ${event.closedAs}`;
  if (event.kind === "comment-to-you") return `The user commented on ${titled(event.issueId, titles)}: ${event.commentId}`;
  const on = issueName(event.issueId, titles, event.agentId);
  switch (event.kind) {
    case "handoff":
      return `${on} handed off: ${event.status}`;
    case "sent-back":
      return `${on} handed off: done, ${failedVerification(checkedOf(check(event.checkId)))}, findings sent back to it (fix round ${event.round})`;
    case "idle-without-handoff":
      return `${on} ended its turn without a handoff`;
    case "failed":
      return `${on} failed`;
    case "needs-input":
      return `${on} is waiting on the user in its thread`;
    case "pr":
      return `${on} ${prName(event.pr)}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}`;
    case "returned-to-todo":
      return `${on} returned to Todo: its agent was ${event.how}`;
    case "comment":
      return `${on} commented: ${event.commentId}`;
    default:
      return event satisfies never;
  }
}

/**
 * A question the user answered: the manager's own, with its words; one the plugin asked at an
 * issue's cap, with the choice the answer makes (cap-choice.ts), or as the question when they
 * answered in their own words, which only crew_catch_up gives.
 */
function answeredLine(decision: Decision): string {
  const asWords = `The user answered your question ${decision.id}: ${decision.question}`;
  if (!isCapQuestion(decision)) return asWords;
  const choice = capChoice(decision);
  return choice === null ? asWords : `The user answered ${decision.id}, the plugin's question at ${decision.issueId}'s cap: ${choicePhrase(choice)}`;
}

/** An issue as a wake line names it: its id, its title, and the agent the line is about, as `BBP-1 "Add retries" (a1)`. */
export const issueName = (issueId: IssueId, titles: ReadonlyMap<IssueId, string>, agentId: AgentId): string => `${titled(issueId, titles)} (${agentId})`;

/** An issue by its id and its title, as `BBP-1 "Add retries"`. */
export function titled(issueId: IssueId, titles: ReadonlyMap<IssueId, string>): string {
  const title = titles.get(issueId);
  return title === undefined ? issueId : `${issueId} "${title}"`;
}

/** The check a `checked` event names. why throw: the event is inserted with its check, in one transaction. */
export function checkedOf(check: Check | null): Check {
  if (check === null) throw new Error("A checked check is missing.");
  return check;
}

/** The decision an event names. why throw: its event is inserted as it is answered, in one transaction. */
export function askedOf(decision: Decision | null): Decision {
  if (decision === null) throw new Error("An answered decision is missing.");
  return decision;
}

/**
 * A check made final, by what it judged: `BBP-1 "Add retries" (a1) handed off: done, verified`, `BBP-1 "Card vault" final check: failed`;
 * a failure whose settling asked the user at the issue's cap (`asked`, null: none) says so, with the question's id.
 */
function checkedLine(check: Check, asked: CapQuestion | null, titles: ReadonlyMap<IssueId, string>): string {
  const { subject, issueId } = check;
  switch (subject.kind) {
    case "handoff":
      return `${issueName(issueId, titles, subject.agentId)} handed off: done, ${checkedAs(check)}${asked === null ? "" : `; ${askedText(issueId, asked, mayHaveReachedAgent(check.verdict))}`}`;
    case "final":
      return `${titled(issueId, titles)} final check: ${finalCheckedAs(check)}`;
    default:
      return subject satisfies never;
  }
}

/** What a final check found, in words derived from its verdict alone. */
function finalCheckedAs({ verdict }: Check): string {
  const result = outcome(verdict);
  switch (result) {
    case "pass":
      return "passed";
    case "fail":
      return "failed";
    case "could-not-run":
      return "could not run";
    case "unverified":
      return "not run, verification is off";
    case "pending":
    case "waiting-for-ci":
    case "superseded":
      // why: a checked event is recorded once the verdict is final, which none of these is.
      return "not checked yet";
    default:
      return result satisfies never;
  }
}

/**
 * A failed done handoff's verdict in a phrase: "failed verification", then what failed it besides
 * its criteria, as "failed verification" already says those. One wording for every update that
 * announces it: sent back as the fix round, or checked.
 */
export function failedVerification({ verdict }: Pick<Check, "verdict">): string {
  const because = verdict.state === "returned" ? failurePhrases(failureReasons(verdict), "handoff") : [];
  return ["failed verification", ...because].join(", ");
}

/** What the plugin's check of a done handoff found, in words derived from its verdict alone. */
function checkedAs({ verdict }: Check): string {
  const result = outcome(verdict);
  const ci = verdict.state === "returned" ? ciVerdictOf(verdict) : null;
  switch (result) {
    case "pass":
      if (ci?.kind === "not-checked") return "verified, CI not checked";
      return ci?.kind === "no-checks" ? "verified, no CI checks" : "verified";
    case "fail": {
      const failed = failedVerification({ verdict });
      return mayHaveReachedAgent(verdict) ? `${failed}, findings may or may not have reached it` : failed;
    }
    case "could-not-run":
      return "could not be verified";
    case "unverified":
      return "unverified";
    case "pending":
    case "waiting-for-ci":
    case "superseded":
      // why: a checked event is recorded once the verdict is final, which neither of these is.
      return "not checked yet";
    default:
      return result satisfies never;
  }
}
