// What crew_catch_up and issue_read say about events, handoffs, reminders and decisions:
// everything, whole, however long. This is where an agent's own words, a verifier's, and the user's
// answers reach the regional manager, as a tool result, each marked as whose they are.
import { sameModel } from "../../model/agent/execution.ts";
import type { Agent } from "../../model/agent/agent.ts";
import type { Decision, DecisionId } from "../../model/decision.ts";
import { firstLine, type Comment, type CommentId } from "../../model/feed/comment.ts";
import type { Handoff, HandoffId } from "../../model/agent/handoff.ts";
import type { StoredEvent } from "../../model/inbox/inbox-event.ts";
import { filesText } from "../../model/inbox/own-tree.ts";
import { askedOf, checkedOf, failedVerification, issueName, titled } from "../../model/inbox/wake-text.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import { STATUS_LABELS, type Handed, type IssueView } from "../../model/issue/status.ts";
import type { MemoryFile } from "../../model/memory-file.ts";
import { intervalText, type Reminder } from "../../model/reminder.ts";
import { checkedAgents, type Check, type CheckId, type FinalCheck } from "../../model/verdict/check.ts";
import { checkoutText, worktreeText } from "../../model/verdict/checkout.ts";
import { PR_CHANGE_WORDS, type CiVerdict, type PrSnapshot } from "../../model/verdict/pr.ts";
import { findingText, type Review } from "../../model/verdict/review.ts";
import { ciVerdictOf, confirmedFindings, failurePhrases, failureReasons, mayHaveReachedAgent, outcome, type Verdict } from "../../model/verdict/verdict.ts";
import { reportFileOf } from "../memory/report-file.ts";

/** What the texts look up, all within one regional manager. */
export type Lookups = {
  /** Each issue's title, as the regional manager gave it. */
  titles: ReadonlyMap<IssueId, string>;
  handoff(id: HandoffId): Handed | null;
  check(id: CheckId): Check | null;
  /** Every agent of the regional manager. */
  agents(): readonly Agent[];
  decision(id: DecisionId): Decision | null;
  comment(id: CommentId): Comment | null;
  /** Whether the issue has a check queued or running, as stored now: one a message to its agent drops. */
  checking(id: IssueId): boolean;
  /** The issue's view, as the board in the same catch-up places it; null when bb's thread list couldn't be read. */
  view(id: IssueId): IssueView | null;
};

/** The updates section of a catch-up: every event it returned, oldest first. */
export function updatesText(events: readonly StoredEvent[], lookups: Lookups): string {
  if (events.length === 0) return "## Updates\n\nNothing new since your last catch-up.";
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  return [`## Updates\n\n${count} since your last catch-up, oldest first.`, ...events.map((stored) => eventText(stored, lookups))].join("\n\n");
}

function eventText({ event, at }: StoredEvent, lookups: Lookups): string {
  const { titles, decision } = lookups;
  const when = `At ${new Date(at).toISOString()}.`;
  if (event.kind === "memory-edited") return `### The user edited ${event.file}\n\n${when} Its current text is in the memory below, or read it with crew_memory_read.`;
  if (event.kind === "verification-toggled") {
    return event.verify
      ? `### The user turned verification on\n\n${when} Build issues' done handoffs made from now on get an independent verifier, and reach you with its verdict. A research issue's is never verified.`
      : `### The user turned verification off\n\n${when} Done handoffs made from now on reach you unverified: read their evidence before you call the work done.`;
  }
  if (event.kind === "reminder") {
    const repeats = event.everyMs === null ? "It was a one-off, so it is gone." : `It repeats every ${intervalText(event.everyMs)}; Reminders below says when it is next due.`;
    return `### Your reminder ${event.reminderId}: ${event.note}\n\n${when} It was due at ${new Date(event.dueAt).toISOString()}. ${repeats}`;
  }
  if (event.kind === "decision-answered") return answeredText(askedOf(decision(event.decisionId)), when);
  if (event.kind === "coordinator-edited-files") return `### Your own environment has ${filesText(event.fileCount)} changed\n\n${when} ${MOVE_TO_AN_AGENT}`;
  if (event.kind === "coordinator-tree-clean") return `### Your own environment is clean again\n\n${when} Your turn ended with no changed files in your working tree, so the warning is gone from the board.`;
  if (event.kind === "checked") {
    const check = checkedOf(lookups.check(event.checkId));
    const { subject } = check;
    switch (subject.kind) {
      case "handoff": {
        const handed = handedOf(subject.handoffId, lookups);
        const yours = outcome(check.verdict) === "fail" ? `\n\n${fixRoundNote(check.verdict)}${FAILED_IS_YOURS}` : "";
        return `### ${issueName(event.issueId, titles, subject.agentId)} handed off: done\n\n${when} Its report, in its own words:\n\n${handoffText(handed, lookups)}${yours}`;
      }
      case "final":
        return `### ${titled(event.issueId, titles)} final check\n\n${when} ${finalCheckText({ ...check, subject }, lookups)}\n\n${finalNextStep({ ...check, subject }, lookups.view(event.issueId))}`;
      default:
        return subject satisfies never;
    }
  }
  if (event.kind === "unblocked") {
    return `### ${titled(event.issueId, titles)} is unblocked: ${event.by} ${event.closedAs}\n\n${when} ${event.by} was the last open issue blocking ${event.issueId}, as its own dependency or its parent's. Nothing of ${event.by} reaches ${event.issueId} on its own: what its agent needs from it, such as a report's file, goes in its brief or a message to its agent. The board below says where ${event.issueId} stands now.`;
  }
  if (event.kind === "comment-to-you") {
    const comment = commentOf(event.commentId, lookups);
    return `### The user commented on ${titled(event.issueId, titles)}: ${comment.id}\n\n${when}${answers(comment, lookups)} In their own words:\n\n${comment.text}\n\n${commentNextStep(comment, lookups.view(event.issueId), lookups.checking(event.issueId))}`;
  }
  const on = issueName(event.issueId, titles, event.agentId);
  switch (event.kind) {
    case "comment": {
      const comment = commentOf(event.commentId, lookups);
      return `### ${on} commented: ${comment.id}\n\n${when}${answers(comment, lookups)} In its own words:\n\n${comment.text}`;
    }
    case "handoff": {
      const handed = handedOf(event.handoffId, lookups);
      return `### ${on} handed off: ${handed.handoff.status}\n\n${when} Its report, in its own words:\n\n${handoffText(handed, lookups)}`;
    }
    case "sent-back": {
      const check = checkedOf(lookups.check(event.checkId));
      const { subject } = check;
      // why throw: only a handoff's verdict goes back to an agent.
      if (subject.kind !== "handoff") throw new Error(`The check ${event.checkId} sent back judges no handoff.`);
      return `### ${on} handed off: done, ${failedVerification(check)}, findings sent back to it\n\n${when} The plugin sent the verifier's findings to ${event.agentId} as its automatic fix round ${event.round}. Nothing to do yet: it fixes them and hands off again, and a new verifier checks that. If that fails too, it comes to you. Its report, in its own words:\n\n${handoffText(handedOf(subject.handoffId, lookups), lookups)}`;
    }
    case "idle-without-handoff":
      return `### ${on} ended its turn without a handoff\n\n${when} ${event.lastAnswer === null ? "It gave no answer." : `Its last answer, in its own words:\n\n${event.lastAnswer.trim()}`}`;
    case "failed":
      return `### ${on} failed\n\n${when} ${event.error === null ? "bb gave no error message." : `bb's error:\n\n${event.error.trim()}`} Read the issue with issue_read before deciding what to do.`;
    case "needs-input":
      return `### ${on} is waiting on the user in its thread\n\n${when} Only the user can answer it there; tell them in your reply. It asks, in its own words:\n\n${event.question.trim()}`;
    case "pr":
      return `### ${on} PR #${event.pr.number}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}\n\n${when} ${prText(event.pr)} A done handoff's verdict that waits for CI settles on its own; you hear of it then.`;
    case "returned-to-todo":
      return `### ${on} returned to Todo\n\n${when} ${event.agentId} was ${event.how} before its work reached Reviewing, Verifying, In review or Done, so ${event.issueId} rests in Todo with no agent. Start one with agent_start, or plan it again with issue_update.`;
    default:
      return event satisfies never;
  }
}

/** The comment an event names. why throw: its event is inserted with it, in one transaction. */
function commentOf(id: CommentId, { comment }: Lookups): Comment {
  const found = comment(id);
  if (found === null) throw new Error(`The comment ${id} is missing.`);
  return found;
}

/** What a comment answers, as " It answers m1, the user's: <its first line>"; nothing when it answers none. */
function answers({ replyTo }: Comment, lookups: Lookups): string {
  if (replyTo === null) return "";
  const { author, text } = commentOf(replyTo, lookups);
  return ` It answers ${replyTo}, ${whose(author)}: "${firstLine(text)}".`;
}

function whose(author: Comment["author"]): string {
  switch (author.kind) {
    case "user":
      return "the user's";
    case "manager":
      return "yours";
    case "agent":
      return `${author.agentId}'s`;
    default:
      return author satisfies never;
  }
}

/**
 * What the regional manager does with the user's comment, by where its issue stands now (`view`, as
 * the board in the same catch-up places it; null: bb's thread list couldn't be read) and whether a
 * check of its is queued or running (`checking`). why the stored check, not only the status: a
 * message to an agent drops its open check, and a done handoff queues one while the agent's turn
 * still runs, which the board shows as In progress.
 */
function commentNextStep({ id, issueId }: Comment, view: IssueView | null, checking: boolean): string {
  const answer = `Reply on the issue with issue_comment (issue "${issueId}", replyTo "${id}"), record what it decides with issue_update (id "${issueId}", decision)`;
  // why issue_read, not another catch-up: this update comes only once, and the plugin's own record of the issue doesn't need bb's thread list.
  if (view === null) return `${answer}. Where ${issueId} stands, and whether an agent holds it, couldn't be read with the board${checking ? `, but a check of a done handoff on it is queued or running, so don't relay it to an agent now` : ""}. ${RELAY_WAIT}`;
  const now = `${issueId} is ${STATUS_LABELS[view.status]} now`;
  // why first: a parent never has an agent, so its work is its sub-issues'. Their agents can comment only on their own issue, so the answer comes back through the manager.
  if (view.subIssues !== null) return `${answer}, or put it in the brief of the sub-issue it concerns. An agent already on that sub-issue gets it only as a relay with agent_message, quoting their words. ${RELAY_WAIT} It can't comment on ${issueId}: ask it to answer with issue_comment on its own sub-issue, and once its answer reaches you, reply to the user on ${issueId} with issue_comment (replyTo "${id}"). ${now}; a parent has no agent of its own.`;
  // why: agent_start refuses a closed issue.
  if (view.status === "done" || view.status === "canceled") return `${answer}, or file what it asks for as a new issue with issue_create. ${now}, so no agent can start on it.`;
  if (view.holder === null) return `${answer}, or put it in the brief of the agent you start on it. ${now}, and no agent holds it.`;
  const agent = view.holder.id;
  const relay = `relay it to ${agent} with agent_message, quoting their words and naming ${id}, so it can answer on the issue`;
  if (checking) return `Nothing reaches ${agent} on its own: the user's comments come to you. ${answer}. Don't relay it to ${agent} now: a check of its done handoff is queued or running, and a message drops it. Only if it concerns ${agent}'s work, ${relay}, once that check has settled. ${RELAY_WAIT} ${now}, while its check waits.`;
  return `Nothing reaches ${agent} on its own: the user's comments come to you. ${answer}, or, when it concerns ${agent}'s work, ${relay}. ${RELAY_WAIT} ${now}.`;
}

/** When a relay must wait, and the fresh read that tells: what this catch-up read may have changed by the time the manager relays. */
const RELAY_WAIT =
  `Never relay while a check of its handoff is queued or running (Reviewing or Verifying, or a done handoff its agent made while its turn still runs): a message drops that check. Read the agent's issue with issue_read just before you relay, and wait while a handoff's verdict there reads "Not in yet": the verdict reaches you once it settles.`;

/** A decision the user answered: what was asked and offered, then the answer, marked as theirs. */
function answeredText({ id, question, options, answer }: Decision, when: string): string {
  if (answer === null) throw new Error(`The decision ${id} is announced as answered, but has no answer.`);
  const offered = options.length === 0 ? "You offered no options." : `You offered: ${options.map((option) => `"${option}"`).join(", ")}.`;
  const theirs = options.includes(answer.text) ? `They chose "${answer.text}".` : `Their answer, in their own words:\n\n${answer.text}`;
  return `### The user answered your question ${id}\n\n${when} You asked: ${question} ${offered} ${theirs}`;
}

/** The decisions section of a catch-up: every decision still waiting for the user, oldest first. */
export function openDecisionsText(decisions: readonly Decision[]): string {
  const open = decisions.filter((decision) => decision.answer === null);
  if (open.length === 0) return "## Decisions\n\nNone waiting for the user. Ask one with crew_ask_user when only the user can decide.";
  const lines = open.map(({ id, question, options, askedAt }) => `- ${id}, asked ${new Date(askedAt).toISOString()}: ${question}${options.length === 0 ? "" : ` Options: ${options.map((option) => `"${option}"`).join(", ")}.`}`);
  return ["## Decisions\n\nWaiting for the user on the board, under Needs you. Their answer wakes you; don't ask again meanwhile.", ...lines].join("\n\n");
}

/** The reminders section of a catch-up: every reminder the thread has set, soonest due first. */
export function remindersText(reminders: readonly Reminder[]): string {
  if (reminders.length === 0) return "## Reminders\n\nNone set. Set one with crew_remind instead of waiting or polling.";
  return ["## Reminders\n\nCancel one with crew_remind and its id as cancel.", ...reminders.map((reminder) => `- ${reminderText(reminder)}`)].join("\n\n");
}

/** One reminder in a line: its id, when it is next due, how often it repeats, and its note. */
export function reminderText({ id, note, dueAt, everyMs }: Reminder): string {
  return `${id}, due ${new Date(dueAt).toISOString()}${everyMs === null ? "" : `, then every ${intervalText(everyMs)}`}: ${note}`;
}

/** The handoff an event or a check names. why throw: each is inserted with its handoff, in one transaction. */
function handedOf(id: HandoffId, { handoff }: Lookups): Handed {
  const handed = handoff(id);
  if (handed === null) throw new Error(`The handoff ${id} is missing.`);
  return handed;
}

/** What became of the fix round of a failed verdict that is the coordinating thread's, when it was tried. */
function fixRoundNote(verdict: Verdict): string {
  if (mayHaveReachedAgent(verdict)) return MAY_HAVE_REACHED_AGENT;
  const refused = verdict.state === "returned" && verdict.settlement.kind === "checked" ? verdict.settlement.refused : null;
  return refused === null ? "" : `bb refused the verifier's findings when the plugin sent them to the agent as its automatic fix round, so the agent never got them and the round is not spent. bb answered: ${refused}. `;
}

const MAY_HAVE_REACHED_AGENT =
  "The plugin was cut off while it sent the verifier's findings to the agent as its automatic fix round (it stopped, or bb's answer never came back whole), and nothing bb keeps shows whether they arrived: they may or may not have. Read the issue with issue_read before you message the agent, so it doesn't get them twice. ";

const MOVE_TO_AN_AGENT =
  "bb's git plugin read changed files in your working tree when your turn ended, and the board warns the user of it. You never edit project files yourself, and you never touch your working tree: no stash, revert, checkout or deletion, not even of files you changed, since the user may have edited the same files. First propose, in a crew_ask_user decision, an issue whose agent redoes the change properly on its own branch, always, whatever the user's rules say: describe its title, brief and done-criteria, file it with issue_create, and start its agent only once they agree. In the same decision, ask the user whether to discard the changes in your environment: discarding them is theirs to do, never yours. If you made none of these changes, they are the user's: leave them and say so in your reply. The warning stays until a turn of yours ends with a clean tree.";

const FAILED_IS_YOURS =
  "It failed verification and is yours to decide: message the agent with agent_message, stop it with agent_stop and start a fresh agent on the issue with agent_start, or ask the user.";

/** A handoff whole: its status, summary, and commit and pull request, every item of every list, then a done one's report or verdict. */
export function handoffText({ handoff, check }: Handed, lookups: Pick<Lookups, "agents">): string {
  const report = [handoffFieldsText(handoff)];
  const delivery = handoff.status === "done" ? handoff.delivery : null;
  if (delivery?.kind === "report") report.push(`#### Report\n\n${reportFileText(handoff.issueId, delivery.file)}\n\n${delivery.report}`);
  if (check !== null) report.push(`#### Verdict\n\n${verdictText(check, lookups)}`);
  return report.join("\n\n");
}

/** A final check whole, as crew_catch_up and issue_read print it: "Final check on main at 4be0a17: …", or where it stands. */
export function finalCheckText(check: FinalCheck, lookups: Pick<Lookups, "agents">): string {
  const { merged } = check.subject;
  return `Final check of ${merged.length === 0 ? "the default branch" : `the merged work of ${merged.join(", ")}`}: ${verdictText(check, lookups)}`;
}

/**
 * What the regional manager does about a final check made final, by where its parent stands now
 * (`view`, as the board in the same catch-up places it; null: bb's thread list couldn't be read).
 * why from the view, never from the check's outcome: a sub-issue filed under the parent, or the
 * manager's close, places it instead of a verdict that returned after it.
 */
function finalNextStep({ id, issueId, verdict }: FinalCheck, view: IssueView | null): string {
  if (view === null) return `Where ${issueId} stands now couldn't be read with the board: call crew_catch_up again before you act on it.`;
  const now = `${issueId} is ${STATUS_LABELS[view.status]}${view.needsYou === null ? "" : " and Needs you"}`;
  if (view.placing?.id !== id) return `${now}. This final check no longer places it: the board below says where it stands.`;
  const result = outcome(verdict);
  switch (result) {
    case "pass":
      return `${now}.`;
    case "fail":
    case "could-not-run":
      return `${now}. File the fix as a new sub-issue of ${issueId} (issue_create with parent "${issueId}") and start its agent: once it is Done and merged, a new final check starts by itself. A final check never goes back to anyone, and isn't run again without new merged work. Or ask the user.`;
    case "unverified":
      return `${now}: nobody checked it on the default branch. Read what its sub-issues did, then accept it with issue_update { id: "${issueId}", status: "done" }, or ask the user.`;
    case "pending":
    case "waiting-for-ci":
    case "superseded":
      // why: a checked event is recorded once the verdict is final, which none of these is.
      return "";
    default:
      return result satisfies never;
  }
}

/** A handoff's own fields: its status, summary, and commit and pull request, then every item of every list under its `####` heading. */
export function handoffFieldsText(handoff: Handoff): string {
  const head = [`Status: ${handoff.status}`, `Summary: ${handoff.summary}`];
  const delivery = handoff.status === "done" ? handoff.delivery : null;
  if (delivery?.kind === "commit") head.push(`Commit: ${delivery.headSha}`, `Pull request: ${delivery.prUrl ?? "none"}`);
  const lists = (
    [
      ["Did", handoff.did],
      ["Evidence", handoff.evidence],
      ["Concerns", handoff.concerns],
      ["Deviations", handoff.deviations],
      ["Findings", handoff.findings],
    ] as const
  ).map(([name, items]) => `#### ${name}\n\n${items.length === 0 ? "None." : items.map((item) => `- ${item.replaceAll("\n", "\n  ")}`).join("\n")}`);
  return [head.join("\n"), ...lists].join("\n\n");
}

/** Where a report was saved, and that handing it on is the regional manager's. */
function reportFileText(issueId: IssueId, file: MemoryFile): string {
  const home = reportFileOf(issueId);
  const kept = file === home ? "" : ` ${home} is not as the plugin last saved it there (someone edited or wrote it), so it is kept as it is.`;
  return `Saved in your memory as ${file}.${kept} The plugin gives it to no agent: name the file in the brief of an agent that needs it, which reads it with crew_memory_read.`;
}

/** A pull request as the plugin read it from GitHub. Check names are GitHub's, as the repository's CI names them. */
function prText(pr: PrSnapshot): string {
  const state = pr.state === "open" && pr.draft ? "open, as a draft" : pr.state;
  const review = { approved: "approved", "changes-requested": "changes requested", none: "no approval or change request" }[pr.review];
  const ci = {
    none: "no checks reported",
    pending: "still running",
    pass: "passed",
    fail: `failed${pr.failedChecks.length === 0 ? "" : ` (${pr.failedChecks.map((name) => `\`${name}\``).join(", ")})`}`,
  }[pr.ci];
  return `It is ${state} (${pr.url}), with ${review}; CI on its head ${pr.headSha.slice(0, 7)}: ${ci}.`;
}

/** What CI said about a verdict's commit, in a line (empty: the verdict is still to settle, and doesn't wait for CI). A verdict superseded while it waited never had CI judged. */
function ciLine(verdict: Extract<Verdict, { state: "returned" }>, ci: CiVerdict | null): string {
  if (ci === null) {
    if (verdict.settlement.kind === "waiting-for-ci") return "CI: still to finish on this commit; the verdict waits for it.";
    return verdict.settlement.kind === "superseded" ? "CI: not waited for; a newer handoff or a handover replaced it first." : "";
  }
  switch (ci.kind) {
    case "none":
      return "CI: no pull request to wait for.";
    case "no-checks":
      return `CI: no checks; GitHub reported none on #${ci.number} at this commit, after the wait for them.`;
    case "pass":
      return `CI: passed on #${ci.number} at this commit.`;
    case "fail":
      return `CI: failed on #${ci.number} at this commit${ci.failedChecks.length === 0 ? "" : `; failed checks, as GitHub names them: ${ci.failedChecks.join(", ")}`}.`;
    case "not-checked":
      return `CI: not checked (${ci.reason}).`;
    default:
      return ci satisfies never;
  }
}

/** What the plugin's check found. A verifier's evidence is its own words, marked as such. */
function verdictText(check: Check, lookups: Pick<Lookups, "agents">): string {
  const { verdict, subject } = check;
  switch (verdict.state) {
    case "queued":
    case "running":
      return "Not in yet: a verifier is checking it.";
    case "returned": {
      const ci = ciVerdictOf(verdict);
      const failedBy = failureReasons(verdict);
      const label = failedBy.length > 0 ? "Failed verification" : ci === null ? "Passed every criterion" : "Verified";
      // why the checkout, must-fix findings and CI first when they failed the verdict: its criteria may all have passed.
      const reasons = failurePhrases(failedBy, subject.kind);
      const reason = reasons.length === 0 ? "" : ` ${reasons.join(", and ")}.`;
      const count = verdict.criteria.filter((check) => check.result === "pass").length;
      const by = verifiedOn(verdict, check, checkedAgents(check, lookups.agents()));
      const counted = `${label}:${reason} ${count} of ${verdict.criteria.length} criteria passed`;
      const head = [
        subject.kind === "handoff" ? `${counted}, checked at ${verdict.headSha} by a verifier on ${by}.` : `${counted} on ${subject.defaultBranch} at ${verdict.headSha}, by a verifier on ${by}.`,
        subject.kind === "handoff" ? checkoutText(verdict.headSha, verdict.checkout) : worktreeText(verdict.checkout),
        // why none for a final check: it judges the default branch, with no pull request to wait for.
        subject.kind === "handoff" ? ciLine(verdict, ci) : "",
        "Each result, with its evidence in the verifier's words:",
      ]
        .filter((part) => part !== "")
        .join(" ");
      const checks = verdict.criteria.map((check, i) => `${i + 1}. ${check.result.toUpperCase()}: ${check.criterion}\n   ${check.evidence.replaceAll("\n", "\n   ")}`);
      const findings = verdict.findings.length === 0 ? "Findings: none." : `Findings:\n${verdict.findings.map((finding) => `- ${finding.replaceAll("\n", "\n  ")}`).join("\n")}`;
      return [head, ...checks, findings, ...reviewText(check.review, verdict)].join("\n\n");
    }
    case "could-not-run":
      return `Couldn't verify: ${verdict.reason}. Nobody has checked it against the done-criteria.`;
    case "superseded":
      return subject.kind === "handoff" ? "Replaced by a newer handoff before its verdict; that one is checked instead." : "Replaced by a newer final check before its verdict; that one is checked instead.";
    case "waived":
      return "Unverified: verification was off, so nobody has checked it against the done-criteria.";
    default:
      return verdict satisfies never;
  }
}

/**
 * What came of a returned verdict's review: no review was had, and why; or what its reviewer found,
 * on what model, each finding as the verifier triaged it, confirmed must-fix ones first, as each
 * failed the verdict, then the other confirmed ones, then the rejected ones, each with the
 * verifier's reason, and whether the confirmed ones went to the agent. Nothing for a check with no review stage.
 */
function reviewText(review: Review, verdict: Extract<Verdict, { state: "returned" }>): string[] {
  if (review.state === "missed") return [`Review: no review was had, as ${review.reason}.`];
  if (review.state !== "reported") return [];
  const by = `${review.model.providerId} ${review.model.model}`;
  if (review.findings.length === 0) return [`Review: a reviewer on ${by} found nothing.`];
  const all = verdict.triage;
  const lines = (findings: typeof all) => findings.map((finding) => `- ${findingText(finding).replaceAll("\n", "\n  ")}\n  Why: ${finding.reason}`);
  const { failing, others } = confirmedFindings(verdict);
  const mustFix = lines(failing);
  const confirmed = lines(others);
  const rejected = lines(all.filter((finding) => finding.result === "rejected"));
  const confirmedCount = mustFix.length + confirmed.length;
  return [
    [`Review: a reviewer on ${by} reported ${all.length} finding${all.length === 1 ? "" : "s"}; the verifier confirmed ${confirmedCount} and rejected ${rejected.length}.`, ...(confirmedCount === 0 ? [] : [confirmedSent(verdict)])].join(" "),
    ...(mustFix.length === 0 ? [] : [`Confirmed must-fix, each of which fails the verdict:\n${mustFix.join("\n")}`]),
    ...(confirmed.length === 0 ? [] : [`${mustFix.length === 0 ? "Confirmed" : "Confirmed, the others"}:\n${confirmed.join("\n")}`]),
    ...(rejected.length === 0 ? [] : [`Rejected:\n${rejected.join("\n")}`]),
  ];
}

/** Whether a verdict's confirmed review findings reached the agent, as far as the plugin knows: only a failed verdict sent back as its fix round carries them. */
function confirmedSent({ settlement }: Extract<Verdict, { state: "returned" }>): string {
  switch (settlement.kind) {
    case "sent-back":
      return "The confirmed ones went back to the agent with the failed verdict.";
    case "sending-back":
      return "The confirmed ones are on their way back to the agent with the failed verdict.";
    case "maybe-sent-back":
      return "The confirmed ones went with the failed verdict's findings, which may or may not have reached the agent.";
    case "pending":
    case "waiting-for-ci":
      return "None has gone to the agent yet.";
    case "checked":
    case "superseded":
      return "None of them went to the agent.";
    default:
      return settlement satisfies never;
  }
}

/**
 * What a verifier ran on, and why: on the verifier named on the issue, as named; else why not the
 * one named (an agent whose work it checks did that work on it, or bb can't run it where the check
 * runs); and whenever it is the model of one of those agents (`theirs`), that no other was
 * available, the one named included.
 */
function verifiedOn(verdict: Extract<Verdict, { state: "returned" }>, { verifier: named, issueId, subject }: Check, theirs: readonly Agent[]): string {
  const ran = `${verdict.model.providerId} ${verdict.model.model}`;
  const ownerOf = (model: Pick<Agent["execution"], "providerId" | "model">) => theirs.find(({ execution }) => sameModel(execution, model))?.id ?? null;
  const owner = verdict.sameModel ? ownerOf(verdict.model) : null;
  const own = owner === null ? "" : `, ${owner}'s own model, as no other was available`;
  if (named === null) return `${ran}${own}`;
  if (sameModel(named, verdict.model)) return own === "" ? `${ran}, as named on ${issueId}` : `${ran}${own}; it is also the one named on ${issueId}`;
  const namedOwner = ownerOf(named);
  const why = namedOwner !== null ? `${namedOwner} did the work on it` : `bb can't run it ${whereChecked(subject)}`;
  return `${ran}${own}, not the ${named.providerId} ${named.model} named on ${issueId}: ${why}`;
}

/** Where a check's verifier runs, as a place bb can or can't run a model: the agent's environment; for a final check, the regional manager's machine. */
function whereChecked(subject: Check["subject"]): string {
  switch (subject.kind) {
    case "handoff":
      return `in ${subject.agentId}'s environment`;
    case "final":
      return "on your machine";
    default:
      return subject satisfies never;
  }
}
