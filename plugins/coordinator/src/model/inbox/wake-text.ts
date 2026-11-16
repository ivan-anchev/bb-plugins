// The doorbell: the short message that wakes a coordinating thread. It reaches the thread as a
// user-role message, so it holds only facts the plugin derived (a crew's id, a handoff's status, a
// memory file's name) and text the coordinating thread itself wrote: the titles it gave its crews, the
// notes of its reminders and the questions it asked the user. Anything a crew wrote, and the user's
// answers, are read through crew_catch_up, as a tool result, never here.
import type { Decision, DecisionId } from "../decision.ts";
import type { Handoff, HandoffId } from "../handoff.ts";
import { PR_CHANGE_WORDS } from "../verdict/pr.ts";
import type { CrewId } from "../role.ts";
import { ciVerdictOf, mayHaveReachedCrew, outcome } from "../verdict/verdict.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";
import { filesText } from "./own-tree.ts";

type Lookups = {
  /** Each crew's title, as the coordinating thread gave it in crew_start. */
  titles: ReadonlyMap<CrewId, string>;
  handoff(id: HandoffId): Handoff | null;
  decision(id: DecisionId): Decision | null;
};

export function doorbellText(events: readonly StoredEvent[], lookups: Lookups): string {
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  const lines = events.map(({ event }) => `- ${line(event, lookups)}`);
  return [`[${DISPLAY_NAME}] ${count}. Call crew_catch_up to read ${events.length === 1 ? "it" : "them"} in full.`, ...lines].join("\n");
}

function line(event: InboxEvent, { titles, handoff, decision }: Lookups): string {
  if (event.kind === "memory-edited") return `The user edited ${event.file}`;
  if (event.kind === "verification-toggled") return `The user turned verification of done handoffs ${event.verify ? "on" : "off"}`;
  if (event.kind === "reminder") return `Your reminder ${event.reminderId}: ${event.note}`;
  if (event.kind === "decision-answered") return `The user answered your question ${event.decisionId}: ${askedOf(decision(event.decisionId)).question}`;
  if (event.kind === "coordinator-edited-files") return `Your own environment has ${filesText(event.fileCount)} changed after your turn: hand the change to a crew`;
  if (event.kind === "coordinator-tree-clean") return "Your own environment is clean again";
  const title = titles.get(event.crewId);
  const crew = title === undefined ? event.crewId : `${event.crewId} "${title}"`;
  switch (event.kind) {
    case "handoff":
      return `${crew} handed off: ${event.status}`;
    case "checked":
      return `${crew} handed off: done, ${checkedAs(handoff(event.handoffId))}`;
    case "sent-back":
      return `${crew} handed off: done, failed verification, findings sent back to it (fix round ${event.round})`;
    case "idle-without-handoff":
      return `${crew} ended its turn without a handoff`;
    case "failed":
      return `${crew} failed`;
    case "needs-input":
      return `${crew} is waiting on the user in its thread`;
    case "pr":
      return `${crew} PR #${event.pr.number}: ${event.changes.map((change) => PR_CHANGE_WORDS[change]).join(", ")}`;
    default:
      return event satisfies never;
  }
}

/** The decision an event names. why throw: its event is inserted as it is answered, in one transaction. */
export function askedOf(decision: Decision | null): Decision {
  if (decision === null) throw new Error("An answered decision is missing.");
  return decision;
}

/** What the plugin's check of a done handoff found, in words derived from its verdict alone. */
function checkedAs(handoff: Handoff | null): string {
  // why throw: a checked event is inserted with its handoff, in one transaction.
  if (handoff === null) throw new Error("A checked handoff is missing.");
  if (handoff.status !== "done") throw new Error(`The checked handoff ${handoff.id} is ${handoff.status}, not done.`);
  const verdict = outcome(handoff.verdict);
  const ci = handoff.verdict.state === "returned" ? ciVerdictOf(handoff.verdict) : null;
  switch (verdict) {
    case "pass":
      if (ci?.kind === "not-checked") return "verified, CI not checked";
      return ci?.kind === "no-checks" ? "verified, no CI checks" : "verified";
    case "fail": {
      const failed = ci?.kind === "fail" ? `failed verification, CI failed on #${ci.number}` : "failed verification";
      return mayHaveReachedCrew(handoff.verdict) ? `${failed}, findings may or may not have reached it` : failed;
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
      return verdict satisfies never;
  }
}
