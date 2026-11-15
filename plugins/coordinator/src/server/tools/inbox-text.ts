// What crew_catch_up and crew_read say about events and handoffs: everything, whole, however long.
// This is where a crew's own words reach the coordinating thread, as a tool result, each marked as
// the crew's.
import type { Handoff, HandoffId } from "../../model/handoff.ts";
import type { InboxEvent, StoredEvent } from "../../model/inbox/inbox-event.ts";
import type { CrewId } from "../../model/role.ts";

type Lookups = {
  /** Each crew's title, as the coordinating thread gave it. */
  titles: ReadonlyMap<CrewId, string>;
  handoff(id: HandoffId): Handoff | null;
};

/** The updates section of a catch-up: every event it returned, oldest first. */
export function updatesText(events: readonly StoredEvent[], lookups: Lookups): string {
  if (events.length === 0) return "## Updates\n\nNothing new since your last catch-up.";
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  return [`## Updates\n\n${count} since your last catch-up, oldest first.`, ...events.map((stored) => eventText(stored, lookups))].join("\n\n");
}

function eventText({ event, at }: StoredEvent, { titles, handoff }: Lookups): string {
  const when = `At ${new Date(at).toISOString()}.`;
  if (event.kind === "memory-edited") return `### The user edited ${event.file}\n\n${when} Its current text is in the memory below, or read it with crew_memory_read.`;
  const crew = crewName(event, titles);
  switch (event.kind) {
    case "handoff": {
      const report = handoff(event.handoffId);
      // why throw: an event is inserted with its handoff, in one transaction.
      if (report === null) throw new Error(`The handoff ${event.handoffId} is missing.`);
      return `### ${crew} handed off: ${event.status}\n\n${when} Its report, in its own words:\n\n${handoffText(report)}`;
    }
    case "idle-without-handoff":
      return `### ${crew} ended its turn without a handoff\n\n${when} ${event.lastAnswer === null ? "It gave no answer." : `Its last answer, in its own words:\n\n${event.lastAnswer.trim()}`}`;
    case "failed":
      return `### ${crew} failed\n\n${when} ${event.error === null ? "bb gave no error message." : `bb's error:\n\n${event.error.trim()}`} Read its thread with crew_read before deciding what to do.`;
    case "needs-input":
      return `### ${crew} is waiting on the user in its thread\n\n${when} Only the user can answer it there; tell them in your digest. It asks, in its own words:\n\n${event.question.trim()}`;
    default:
      return event satisfies never;
  }
}

const crewName = (event: Extract<InboxEvent, { crewId: CrewId }>, titles: ReadonlyMap<CrewId, string>): string => {
  const title = titles.get(event.crewId);
  return title === undefined ? event.crewId : `${event.crewId} "${title}"`;
};

/** A handoff whole: its status and verdict, summary, commit and pull request, then every item of every list. */
export function handoffText(handoff: Handoff): string {
  const head = [`Status: ${handoff.status}${handoff.status === "done" ? ` (${verdictText(handoff.verdict)})` : ""}`, `Summary: ${handoff.summary}`];
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
  return [head.join("\n"), ...lists].join("\n\n");
}

function verdictText(verdict: Extract<Handoff, { status: "done" }>["verdict"]): string {
  switch (verdict.state) {
    case "waived":
      return "unverified: nobody has checked it against the done-criteria";
    default:
      return verdict.state satisfies never;
  }
}
