// A board's lanes: the decisions put to the user and the issues, each placed by its status, or
// under Needs you while it waits on the user. The board draws them, crew_catch_up lists them and the
// panel's badge counts their Needs you, so the three never disagree.
import { z } from "zod";
import type { Decision } from "../decision.ts";
import { STATUS_LABELS, type IssueStatus } from "../issue/status.ts";

/** The board's lanes, in the order it shows them. */
export const laneSchema = z.enum(["needs-you", "in-review", "verifying", "in-progress", "todo", "backlog", "done", "canceled"]);
export type Lane = z.infer<typeof laneSchema>;

/** Each lane's name, as the board and crew_catch_up show it. */
export const LANE_LABELS: Record<Lane, string> = { "needs-you": "Needs you", ...STATUS_LABELS };

/** An issue's lane: Needs you while it waits on the user, else its status. */
export const laneOf = ({ status, needsYou }: { status: IssueStatus; needsYou: string | null }): Lane => (needsYou === null ? status : "needs-you");

/** The rows in each lane that has any, in the board's order; rows keep their order. */
export function byLane<Row extends { lane: Lane }>(rows: readonly Row[]): { lane: Lane; rows: Row[] }[] {
  return laneSchema.options.flatMap((lane) => {
    const inLane = rows.filter((row) => row.lane === lane);
    return inLane.length === 0 ? [] : [{ lane, rows: inLane }];
  });
}

/** A row on the board: a decision put to the user, or an issue. */
export type BoardItem<Row> = { kind: "decision"; lane: Lane; decision: Decision } | { kind: "issue"; lane: Lane; row: Row };

/** Where a decision sits: under Needs you until the user answers it, then Done. */
const decisionLane = (decision: Decision): Lane => (decision.answer === null ? "needs-you" : "done");

/** The board's rows in each lane that has any, in the board's order; each lane's decisions come first. */
export function boardGroups<Row extends { lane: Lane }>(decisions: readonly Decision[], rows: readonly Row[]): { lane: Lane; rows: BoardItem<Row>[] }[] {
  return byLane<BoardItem<Row>>([
    ...decisions.map((decision) => ({ kind: "decision", lane: decisionLane(decision), decision }) as const),
    ...rows.map((row) => ({ kind: "issue", lane: row.lane, row }) as const),
  ]);
}

/** What waits for the user on one board: how many of its decisions and its issues sit under Needs you. */
export const needsYouSchema = z.object({ decisions: z.number().int().nonnegative(), issues: z.number().int().nonnegative() });
export type NeedsYou = z.infer<typeof needsYouSchema>;

export function needsYou(decisions: readonly Decision[], rows: readonly { lane: Lane }[]): NeedsYou {
  const waiting = boardGroups(decisions, rows).find(({ lane }) => lane === "needs-you")?.rows ?? [];
  return { decisions: waiting.filter((item) => item.kind === "decision").length, issues: waiting.filter((item) => item.kind === "issue").length };
}
