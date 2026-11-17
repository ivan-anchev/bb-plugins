// What crew_catch_up and issue_read say about events, handoffs, reminders and decisions:
// everything, whole, however long. This is where an agent's own words, a verifier's, and the user's
// answers reach the regional manager, as a tool result, each marked as whose they are.
import { sameModel } from "../../model/execution.ts";
import type { Agent, AgentId } from "../../model/agent.ts";
import type { Decision, DecisionId } from "../../model/decision.ts";
import type { HandoffId } from "../../model/handoff.ts";
import type { StoredEvent } from "../../model/inbox/inbox-event.ts";
import { filesText } from "../../model/inbox/own-tree.ts";
import { askedOf, checkedOf, issueName } from "../../model/inbox/wake-text.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { Handed } from "../../model/issue/status.ts";
import type { MemoryFile } from "../../model/memory-file.ts";
import { intervalText, type Reminder } from "../../model/reminder.ts";
import type { Check, CheckId } from "../../model/verdict/check.ts";
import { checkoutText, NOT_CLEAN } from "../../model/verdict/checkout.ts";
import { PR_CHANGE_WORDS, type CiVerdict, type PrSnapshot } from "../../model/verdict/pr.ts";
import { allPassed, ciVerdictOf, failedCheckout, judge, mayHaveReachedAgent, outcome, type Verdict } from "../../model/verdict/verdict.ts";
import { reportFileOf } from "../memory/report-file.ts";

/** What the texts look up, all within one regional manager. */
export type Lookups = {
  /** Each issue's title, as the regional manager gave it. */
  titles: ReadonlyMap<IssueId, string>;
  handoff(id: HandoffId): Handed | null;
  check(id: CheckId): Check | null;
  agent(id: AgentId): Agent | null;
  decision(id: DecisionId): Decision | null;
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
      ? `### The user turned verification on\n\n${when} Done handoffs made from now on get an independent verifier, and reach you with its verdict.`
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
    const handed = handedOf(check.subject.handoffId, lookups);
    const yours = outcome(check.verdict) === "fail" ? `\n\n${fixRoundNote(check.verdict)}${FAILED_IS_YOURS}` : "";
    return `### ${issueName(event.issueId, titles, check.subject.agentId)} handed off: done\n\n${when} Its report, in its own words:\n\n${handoffText(handed, lookups)}${yours}`;
  }
  const on = issueName(event.issueId, titles, event.agentId);
  switch (event.kind) {
    case "handoff": {
      const handed = handedOf(event.handoffId, lookups);
      return `### ${on} handed off: ${handed.handoff.status}\n\n${when} Its report, in its own words:\n\n${handoffText(handed, lookups)}`;
    }
    case "sent-back": {
      const check = checkedOf(lookups.check(event.checkId));
      return `### ${on} handed off: done, failed verification, findings sent back to it\n\n${when} The plugin sent the verifier's findings to ${event.agentId} as its automatic fix round ${event.round}. Nothing to do yet: it fixes them and hands off again, and a new verifier checks that. If that fails too, it comes to you. Its report, in its own words:\n\n${handoffText(handedOf(check.subject.handoffId, lookups), lookups)}`;
    }
    case "idle-without-handoff":
      return `### ${on} ended its turn without a handoff\n\n${when} ${event.lastAnswer === null ? "It gave no answer." : `Its last answer, in its own words:\n\n${event.lastAnswer.trim()}`}`;
    case "failed":
      return `### ${on} failed\n\n${when} ${event.error === null ? "bb gave no error message." : `bb's error:\n\n${event.error.trim()}`} Read the issue with issue_read before deciding what to do.`;
    case "needs-input":
      return `### ${on} is waiting on the user in its thread\n\n${when} Only the user can answer it there; tell them in your digest. It asks, in its own words:\n\n${event.question.trim()}`;
    case "pr":
      return `### ${on} PR #${event.pr.number}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}\n\n${when} ${prText(event.pr)} A done handoff's verdict that waits for CI settles on its own; you hear of it then.`;
    case "returned-to-todo":
      return `### ${on} returned to Todo\n\n${when} ${event.agentId} was ${event.how} before its work reached Verifying, In review or Done, so ${event.issueId} rests in Todo with no agent. Start one with agent_start, or plan it again with issue_update.`;
    default:
      return event satisfies never;
  }
}

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
  "bb's git plugin read changed files in your working tree when your turn ended, and the board warns the user of it. You never edit project files yourself, and you never touch your working tree: no stash, revert, checkout or deletion, not even of files you changed, since the user may have edited the same files. First propose, in a crew_ask_user decision, an issue whose agent redoes the change properly on its own branch, always, whatever the user's preferences: describe its title, brief and done-criteria, file it with issue_create, and start its agent only once they agree. In the same decision, ask the user whether to discard the changes in your environment: discarding them is theirs to do, never yours. If you made none of these changes, they are the user's: leave them and say so in your digest. The warning stays until a turn of yours ends with a clean tree.";

const FAILED_IS_YOURS =
  "It failed verification and is yours to decide: message the agent with agent_message, stop it with agent_stop and start a fresh agent on the issue with agent_start, or ask the user.";

/** A handoff whole: its status, summary, and commit and pull request, every item of every list, then a done one's report or verdict. */
export function handoffText({ handoff, check }: Handed, lookups: Pick<Lookups, "agent">): string {
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
  const report = [head.join("\n"), ...lists];
  if (delivery?.kind === "report") report.push(`#### Report\n\n${reportFileText(handoff.issueId, delivery.file)}\n\n${delivery.report}`);
  if (check !== null) report.push(`#### Verdict\n\n${verdictText(check, lookups.agent(check.subject.agentId))}`);
  return report.join("\n\n");
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

/** What CI said about a verdict's commit, in a line (empty: the verdict is still to settle, and doesn't wait for CI). */
function ciLine(verdict: Extract<Verdict, { state: "returned" }>, ci: CiVerdict | null): string {
  if (ci === null) return verdict.settlement.kind === "waiting-for-ci" ? "CI: still to finish on this commit; the verdict waits for it." : "";
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

/** What the plugin's check found. A verifier's evidence is its own words, marked as such. `agent`: whose work it checks. */
function verdictText({ verdict, verifier, issueId, subject }: Check, agent: Agent | null): string {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "Not in yet: a verifier is checking it.";
    case "returned": {
      const ci = ciVerdictOf(verdict);
      const passed = ci === null ? allPassed(verdict) : judge(verdict, ci) === "pass";
      const label = passed ? (ci === null ? "Passed every criterion" : "Verified") : "Failed verification";
      // why the checkout and CI first when they failed the verdict: its criteria may all have passed.
      const reasons = [...(failedCheckout(verdict) === null ? [] : [NOT_CLEAN.toLowerCase()]), ...(ci?.kind === "fail" ? [`CI failed on #${ci.number}`] : [])];
      const reason = reasons.length === 0 ? "" : ` ${reasons.join(", and ")}.`;
      const count = verdict.criteria.filter((check) => check.result === "pass").length;
      const by = verifiedOn(verdict, verifier, issueId, subject.agentId, agent);
      const head = [
        `${label}:${reason} ${count} of ${verdict.criteria.length} criteria passed, checked at ${verdict.headSha} by a verifier on ${by}.`,
        checkoutText(verdict.headSha, verdict.checkout),
        ciLine(verdict, ci),
        "Each result, with its evidence in the verifier's words:",
      ]
        .filter((part) => part !== "")
        .join(" ");
      const checks = verdict.criteria.map((check, i) => `${i + 1}. ${check.result.toUpperCase()}: ${check.criterion}\n   ${check.evidence.replaceAll("\n", "\n   ")}`);
      const findings = verdict.findings.length === 0 ? "Findings: none." : `Findings:\n${verdict.findings.map((finding) => `- ${finding.replaceAll("\n", "\n  ")}`).join("\n")}`;
      return [head, ...checks, findings].join("\n\n");
    }
    case "could-not-run":
      return `Couldn't verify: ${verdict.reason}. Nobody has checked it against the done-criteria.`;
    case "superseded":
      return "Replaced by a newer handoff before its verdict; that one is checked instead.";
    case "waived":
      return "Unverified: verification was off, so nobody has checked it against the done-criteria.";
    default:
      return verdict satisfies never;
  }
}

/**
 * What a verifier ran on, and why: on the verifier named on the issue, as named; else why not the
 * one named (the agent did the work on it, or bb can't run it where the agent works); and when it
 * is the agent's own model, that no other was available.
 */
function verifiedOn(verdict: Extract<Verdict, { state: "returned" }>, named: Check["verifier"], issueId: IssueId, agentId: AgentId, agent: Agent | null): string {
  const ran = `${verdict.model.providerId} ${verdict.model.model}`;
  const own = verdict.sameModel ? `, ${agentId}'s own model, as no other was available` : "";
  if (named === null) return `${ran}${own}`;
  if (sameModel(named, verdict.model)) return `${ran}, as named on ${issueId}`;
  const why = agent !== null && sameModel(named, agent.execution) ? `${agentId} did the work on it` : `bb can't run it in ${agentId}'s environment`;
  return `${ran}${own}, not the ${named.providerId} ${named.model} named on ${issueId}: ${why}`;
}
