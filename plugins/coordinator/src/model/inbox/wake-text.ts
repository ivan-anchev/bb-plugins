// The doorbell: the short message that wakes a coordinating thread. It reaches the thread as a
// user-role message, so it holds only facts the plugin derived (a crew's id, a handoff's status, a
// memory file's name) and the titles the coordinating thread itself gave its crews. Anything a crew
// wrote is read through crew_catch_up, as a tool result, never here.
import type { CrewId } from "../role.ts";
import { DISPLAY_NAME } from "../../name.ts";
import type { InboxEvent, StoredEvent } from "./inbox-event.ts";

/** `titles`: each crew's title, as the coordinating thread gave it in crew_start. */
export function doorbellText(events: readonly StoredEvent[], titles: ReadonlyMap<CrewId, string>): string {
  const count = events.length === 1 ? "1 update" : `${events.length} updates`;
  const lines = events.map(({ event }) => `- ${line(event, titles)}`);
  return [`[${DISPLAY_NAME}] ${count}. Call crew_catch_up to read ${events.length === 1 ? "it" : "them"} in full.`, ...lines].join("\n");
}

function line(event: InboxEvent, titles: ReadonlyMap<CrewId, string>): string {
  if (event.kind === "memory-edited") return `The user edited ${event.file}`;
  const title = titles.get(event.crewId);
  const crew = title === undefined ? event.crewId : `${event.crewId} "${title}"`;
  switch (event.kind) {
    case "handoff":
      return `${crew} handed off: ${event.status}`;
    case "idle-without-handoff":
      return `${crew} ended its turn without a handoff`;
    case "failed":
      return `${crew} failed`;
    case "needs-input":
      return `${crew} is waiting on the user in its thread`;
    default:
      return event satisfies never;
  }
}
