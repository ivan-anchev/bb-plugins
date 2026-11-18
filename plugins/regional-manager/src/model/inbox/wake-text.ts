// The doorbell: the short message that wakes a regional manager. It reaches the thread as a
// user-role message, so it holds only facts the plugin derived (an issue's and an agent's id, a
// handoff's status, a memory file's name) and text the regional manager itself wrote: the titles it
// gave its issues, the notes of its reminders and the questions it asked the user. Anything an agent
// or a verifier wrote, and the user's answers, are read through crew_catch_up, as a tool result,
// never here.
import type { AgentId } from "../agent.ts";
import type { Decision, DecisionId } from "../decision.ts";
import type { IssueId } from "../issue/issue.ts";
import type { Check, CheckId } from "../verdict/check.ts";
import { PR_CHANGE_WORDS } from "../verdict/pr.ts";
import { ciVerdictOf, mayHaveReachedAgent, outcome } from "../verdict/verdict.ts";
import { DISPLAY_NAME } from "../../name.ts";
import { shownToUser, type InboxEvent, type StoredEvent } from "./inbox-event.ts";
import { changedFilesText, type OwnTree } from "./own-tree.ts";

type Lookups = {
  /** Each issue's title, as the regional manager gave it. */
  titles: ReadonlyMap<IssueId, string>;
  check(id: CheckId): Check | null;
  decision(id: DecisionId): Decision | null;
  /** The regional manager's own checkout as last read, which an unread `coordinator-tree-changed` tells of. */
  ownTree: OwnTree;
};

/** A part of the doorbell's message, as bb takes it: `agent-only`, the user doesn't see it. */
type DoorbellPart = { type: "text"; text: string; mentions: never[]; visibility?: "agent-only" };

/**
 * The doorbell as the parts of one message: the events the user is shown, then the others in a part
 * only the thread sees (see shownToUser). bb leaves a message out of the user's timeline when all of
 * its parts are agent-only, so a doorbell of hidden events alone doesn't show at all.
 */
export function doorbellInput(events: readonly StoredEvent[], lookups: Lookups): DoorbellPart[] {
  const shown = events.filter(({ event }) => shownToUser(event));
  const hidden = events.filter(({ event }) => !shownToUser(event));
  return [
    ...(shown.length === 0 ? [] : [{ type: "text" as const, text: doorbellText(shown, lookups), mentions: [] }]),
    ...(hidden.length === 0 ? [] : [{ type: "text" as const, text: doorbellText(hidden, lookups), mentions: [], visibility: "agent-only" as const }]),
  ];
}

function doorbellText(events: readonly StoredEvent[], lookups: Lookups): string {
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  const lines = events.map(({ event }) => `- ${line(event, lookups)}`);
  return [`[${DISPLAY_NAME}] ${count}. Call crew_catch_up to read ${events.length === 1 ? "it" : "them"} in full.`, ...lines].join("\n");
}

function line(event: InboxEvent, { titles, check, decision, ownTree }: Lookups): string {
  if (event.kind === "memory-edited") return `The user edited ${event.file}`;
  if (event.kind === "verification-toggled") return `The user turned verification of done handoffs ${event.verify ? "on" : "off"}`;
  if (event.kind === "reminder") return `Your reminder ${event.reminderId}: ${event.note}`;
  if (event.kind === "decision-answered") return `The user answered your question ${event.decisionId}: ${askedOf(decision(event.decisionId)).question}`;
  if (event.kind === "coordinator-tree-changed") return `Your turn ended with ${changedFilesText(ownTree)} in your checkout`;
  if (event.kind === "checked") return checkedLine(checkedOf(check(event.checkId)), titles);
  if (event.kind === "unblocked") return `${titled(event.issueId, titles)} is unblocked: ${event.by} ${event.closedAs}`;
  const on = issueName(event.issueId, titles, event.agentId);
  switch (event.kind) {
    case "handoff":
      return `${on} handed off: ${event.status}`;
    case "sent-back":
      return `${on} handed off: done, failed verification, findings sent back to it (fix round ${event.round})`;
    case "idle-without-handoff":
      return `${on} ended its turn without a handoff`;
    case "failed":
      return `${on} failed`;
    case "needs-input":
      return `${on} is waiting on the user in its thread`;
    case "pr":
      return `${on} PR #${event.pr.number}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}`;
    case "returned-to-todo":
      return `${on} returned to Todo: its agent was ${event.how}`;
    default:
      return event satisfies never;
  }
}

/** An issue as a wake line names it: its id, its title, and the agent the line is about, as `i1 "Add retries" (a1)`. */
export const issueName = (issueId: IssueId, titles: ReadonlyMap<IssueId, string>, agentId: AgentId): string => `${titled(issueId, titles)} (${agentId})`;

/** An issue by its id and its title, as `i1 "Add retries"`. */
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

/** A check made final, by what it judged: `i1 "Add retries" (a1) handed off: done, verified`, `i1 "Card vault" final check: failed`. */
function checkedLine(check: Check, titles: ReadonlyMap<IssueId, string>): string {
  const { subject, issueId } = check;
  switch (subject.kind) {
    case "handoff":
      return `${issueName(issueId, titles, subject.agentId)} handed off: done, ${checkedAs(check)}`;
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

/** What the plugin's check of a done handoff found, in words derived from its verdict alone. */
function checkedAs({ verdict }: Check): string {
  const result = outcome(verdict);
  const ci = verdict.state === "returned" ? ciVerdictOf(verdict) : null;
  switch (result) {
    case "pass":
      if (ci?.kind === "not-checked") return "verified, CI not checked";
      return ci?.kind === "no-checks" ? "verified, no CI checks" : "verified";
    case "fail": {
      const failed = ci?.kind === "fail" ? `failed verification, CI failed on #${ci.number}` : "failed verification";
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
