// What crew_catch_up and crew_read say about events, handoffs, reminders and decisions: everything,
// whole, however long. This is where a crew's own words, and the user's answers, reach the
// coordinating thread, as a tool result, each marked as whose they are.
import type { Decision, DecisionId } from "../../model/decision.ts";
import type { Handoff, HandoffId } from "../../model/handoff.ts";
import type { InboxEvent, StoredEvent } from "../../model/inbox/inbox-event.ts";
import { askedOf } from "../../model/inbox/wake-text.ts";
import { intervalText, type Reminder } from "../../model/reminder.ts";
import { PR_CHANGE_WORDS, type CiVerdict, type PrSnapshot } from "../../model/verdict/pr.ts";
import type { CrewId } from "../../model/role.ts";
import { allPassed, ciVerdictOf, judge, mayHaveReachedCrew, outcome, type Verdict } from "../../model/verdict/verdict.ts";

type Lookups = {
  /** Each crew's title, as the coordinating thread gave it. */
  titles: ReadonlyMap<CrewId, string>;
  handoff(id: HandoffId): Handoff | null;
  decision(id: DecisionId): Decision | null;
};

/** The updates section of a catch-up: every event it returned, oldest first. */
export function updatesText(events: readonly StoredEvent[], lookups: Lookups): string {
  if (events.length === 0) return "## Updates\n\nNothing new since your last catch-up.";
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  return [`## Updates\n\n${count} since your last catch-up, oldest first.`, ...events.map((stored) => eventText(stored, lookups))].join("\n\n");
}

function eventText({ event, at }: StoredEvent, { titles, handoff, decision }: Lookups): string {
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
  const crew = crewName(event, titles);
  switch (event.kind) {
    case "handoff":
    case "checked": {
      const report = handoffOf(event, handoff);
      const yours = report.status === "done" && outcome(report.verdict) === "fail" ? `\n\n${fixRoundNote(report.verdict)}${FAILED_IS_YOURS}` : "";
      return `### ${crew} handed off: ${report.status}\n\n${when} Its report, in its own words:\n\n${handoffText(report)}${yours}`;
    }
    case "sent-back":
      return `### ${crew} handed off: done, failed verification, findings sent back to it\n\n${when} The plugin sent the verifier's findings to the crew as its automatic fix round ${event.round}. Nothing to do yet: it fixes them and hands off again, and a new verifier checks that. If that fails too, it comes to you. Its report, in its own words:\n\n${handoffText(handoffOf(event, handoff))}`;
    case "idle-without-handoff":
      return `### ${crew} ended its turn without a handoff\n\n${when} ${event.lastAnswer === null ? "It gave no answer." : `Its last answer, in its own words:\n\n${event.lastAnswer.trim()}`}`;
    case "failed":
      return `### ${crew} failed\n\n${when} ${event.error === null ? "bb gave no error message." : `bb's error:\n\n${event.error.trim()}`} Read its thread with crew_read before deciding what to do.`;
    case "needs-input":
      return `### ${crew} is waiting on the user in its thread\n\n${when} Only the user can answer it there; tell them in your digest. It asks, in its own words:\n\n${event.question.trim()}`;
    case "pr":
      return `### ${crew} PR #${event.pr.number}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}\n\n${when} ${prText(event.pr)} A done handoff's verdict that waits for CI settles on its own; you hear of it then.`;
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

/** The handoff an event names. why throw: an event is inserted with its handoff, in one transaction. */
function handoffOf(event: { handoffId: HandoffId }, handoff: Lookups["handoff"]): Handoff {
  const report = handoff(event.handoffId);
  if (report === null) throw new Error(`The handoff ${event.handoffId} is missing.`);
  return report;
}

/** What became of the fix round of a failed verdict that is the coordinating thread's, when it was tried. */
function fixRoundNote(verdict: Verdict): string {
  if (mayHaveReachedCrew(verdict)) return MAY_HAVE_REACHED_CREW;
  const refused = verdict.state === "returned" && verdict.settlement.kind === "checked" ? verdict.settlement.refused : null;
  return refused === null ? "" : `bb refused the verifier's findings when the plugin sent them to the crew as its automatic fix round, so the crew never got them and the round is not spent. bb answered: ${refused}. `;
}

const MAY_HAVE_REACHED_CREW =
  "The plugin was cut off while it sent the verifier's findings to the crew as its automatic fix round (it stopped, or bb's answer never came back whole), and nothing bb keeps shows whether they arrived: they may or may not have. Read its thread with crew_read before you message it, so it doesn't get them twice. ";

const FAILED_IS_YOURS =
  "It failed verification and is yours to decide: message the crew with crew_message, replace it with a fresh crew through crew_start with supersedes (which carries its brief and these findings), or ask the user.";

const crewName = (event: Extract<InboxEvent, { crewId: CrewId }>, titles: ReadonlyMap<CrewId, string>): string => {
  const title = titles.get(event.crewId);
  return title === undefined ? event.crewId : `${event.crewId} "${title}"`;
};

/** A handoff whole: its status, summary, commit and pull request, every item of every list, then a done one's verdict. */
export function handoffText(handoff: Handoff): string {
  const head = [`Status: ${handoff.status}`, `Summary: ${handoff.summary}`];
  if (handoff.status === "done") head.push(`Commit: ${handoff.headSha}`, `Pull request: ${handoff.prUrl ?? "none"}`);
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
  if (handoff.status === "done") report.push(`#### Verdict\n\n${verdictText(handoff.verdict)}`);
  return report.join("\n\n");
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

/** What the plugin's check found. A verifier's evidence is its own words, marked as such. */
function verdictText(verdict: Verdict): string {
  switch (verdict.state) {
    case "queued":
    case "running":
      return "Not in yet: a verifier is checking it.";
    case "returned": {
      const ci = ciVerdictOf(verdict);
      const passed = ci === null ? allPassed(verdict) : judge(verdict, ci) === "pass";
      const label = passed ? (ci === null ? "Passed every criterion" : "Verified") : "Failed verification";
      const count = verdict.criteria.filter((check) => check.result === "pass").length;
      const by = `${verdict.model.providerId} ${verdict.model.model}${verdict.sameModel ? ", the crew's own model, as no other was available" : ""}`;
      const head = [`${label}: ${count} of ${verdict.criteria.length} criteria passed, checked at ${verdict.headSha} by a verifier on ${by}.`, ciLine(verdict, ci), "Each result, with its evidence in the verifier's words:"].filter((part) => part !== "").join(" ");
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
