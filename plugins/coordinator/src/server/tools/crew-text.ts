// What the crew tools say to the coordinating thread. A crew is always named by its id, with a
// link to its thread, so the agent can both act on it and point the user at it.
import type { BoardRow } from "../../contract.ts";
import { BOARD_STATE_LABELS, byState } from "../../model/crew-state.ts";
import type { CloseOutcome, CrewDetail } from "../crew/crews.ts";
import type { CrewLaunch } from "../spawn.ts";

/** The most of a crew's latest answer crew_read returns. */
const OUTPUT_BUDGET_CHARS = 12_000;

const threadLink = (threadId: string | null): string => (threadId === null ? "no thread" : `@thread:${threadId}`);

/** The board section of a catch-up: every crew under its state, or why it couldn't be read. */
export function boardText(rows: BoardRow[] | { error: string }): string {
  if ("error" in rows) return `## Board\n\nCould not read your crews' threads from bb: ${rows.error}. Call crew_catch_up again before relying on any crew's state.`;
  if (rows.length === 0) return "## Board\n\nNo crews yet. Start one with crew_start.";
  const groups = byState(rows).map(({ state, rows: inState }) => [`### ${BOARD_STATE_LABELS[state]} (${inState.length})`, ...inState.map(rowLine)].join("\n"));
  return ["## Board", ...groups].join("\n\n");
}

const rowLine = (row: BoardRow): string =>
  `- ${row.crewId} "${row.title}", ${threadLink(row.threadId)}${row.branch === null ? "" : ` on branch \`${row.branch}\``}: ${row.headline}`;

export function startText(launch: CrewLaunch): string {
  switch (launch.kind) {
    case "started":
      return `Started ${launch.crewId} as @thread:${launch.threadId}. It works in its own environment on its own branch, and its brief arrived as a message from you. It does not report back by itself yet: check it with crew_read.`;
    case "failed":
      return `${launch.crewId} was saved, but bb did not start its thread: ${launch.error}. It shows on the board as not started. Close it with crew_close (resolve) and start the work again, or tell the user.`;
  }
}

export function detailText({ crew, state, branch, output }: CrewDetail): string {
  const threadId = crew.launch.kind === "started" ? crew.launch.threadId : null;
  const answer =
    output === null
      ? "No answer yet."
      : output.length <= OUTPUT_BUDGET_CHARS
        ? output.trim()
        : `${output.slice(0, OUTPUT_BUDGET_CHARS)}\n\n[Cut here: it has ${output.length} characters. Read the rest in its thread.]`;
  return [
    `## ${crew.id}: ${crew.title}`,
    `${BOARD_STATE_LABELS[state.state]}: ${state.headline}. Thread: ${threadLink(threadId)}${branch === null ? "" : `, branch \`${branch}\``}.`,
    `### Brief\n\n${crew.brief.trim()}`,
    `### Done when\n\n${crew.doneCriteria.map((criterion, i) => `${i + 1}. ${criterion}`).join("\n")}`,
    `### Its latest answer\n\n${answer}`,
  ].join("\n\n");
}

export function closeText(crewId: string, outcome: CloseOutcome): string {
  switch (outcome.kind) {
    case "closed":
      return `${crewId} is ${outcome.as}. It shows under Done.`;
    case "already-closed":
      return `${crewId} was already ${outcome.as}; nothing changed.`;
    case "still-running":
      return `Asked ${crewId} to stop, but its thread is still ${outcome.status}, so it is not recorded as stopped. Call crew_close with stop again shortly.`;
  }
}
