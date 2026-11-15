// Where a crew sits on the board, and the one line that says why. Pure, so the board and
// crew_catch_up share one definition. Every headline comes from facts; no model call.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Crew } from "./crew.ts";

/** The board's groups, in the order it shows them. */
export const boardStateSchema = z.enum(["needs-you", "working", "idle", "done"]);
export type BoardState = z.infer<typeof boardStateSchema>;

/** Each group's name, as the board and crew_catch_up show it. */
export const BOARD_STATE_LABELS: Record<BoardState, string> = { "needs-you": "Needs you", working: "Working", idle: "Idle", done: "Done" };

/** The rows under each state that has any, in the board's order; rows keep their order. */
export function byState<Row extends { state: BoardState }>(rows: readonly Row[]): { state: BoardState; rows: Row[] }[] {
  return boardStateSchema.options.flatMap((state) => {
    const inState = rows.filter((row) => row.state === state);
    return inState.length === 0 ? [] : [{ state, rows: inState }];
  });
}

type ThreadRow = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];

/** The crew's thread as bb lists it now. */
export type CrewThread = Pick<ThreadRow, "status" | "hasPendingInteraction">;

/** `thread` is null when bb no longer lists it: archived or deleted. */
export function crewState(crew: Crew, thread: CrewThread | null): { state: BoardState; headline: string } {
  if (crew.closed !== null) return { state: "done", headline: CLOSED[crew.closed.kind] };
  if (crew.launch.kind === "draft") return { state: "needs-you", headline: `Draft: ${crew.title}` };
  if (thread === null) return { state: "done", headline: "Its thread was archived or deleted" };
  if (thread.hasPendingInteraction) return { state: "needs-you", headline: "Waiting for an answer or an approval in its thread" };
  switch (thread.status) {
    case "error":
      return { state: "needs-you", headline: "Its last turn failed" };
    case "pending":
      return { state: "working", headline: "Waiting to start" };
    case "starting":
      return { state: "working", headline: "Starting" };
    case "active":
      return { state: "working", headline: "Working" };
    case "stopping":
      return { state: "working", headline: "Stopping" };
    case "idle":
      return IDLE;
    default:
      // why not throw: bb can send a status newer than this plugin's SDK. A thread in it is not
      // known to be working, so it shows as idle until bb says otherwise.
      thread.status satisfies never;
      return IDLE;
  }
}

const IDLE = { state: "idle", headline: "Its turn ended: waiting for a message" } as const;

const CLOSED: Record<NonNullable<Crew["closed"]>["kind"], string> = {
  resolved: "Resolved",
  archived: "Archived",
  stopped: "Stopped",
};
