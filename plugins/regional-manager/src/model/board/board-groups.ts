// A board's groups: the decisions put to the user and the crews, each placed by its state. The
// board draws them and the panel's badge counts their Needs you, so the two never disagree.
import { z } from "zod";
import { byState, type BoardState } from "./crew-state.ts";
import { decisionState, type Decision } from "../decision.ts";

/** A row on the board: a decision put to the user, or a crew. */
export type BoardItem<Row> = { kind: "decision"; state: BoardState; decision: Decision } | { kind: "crew"; state: BoardState; row: Row };

/** The board's rows under each state that has any, in the board's order; each group's decisions come first. */
export function boardGroups<Row extends { state: BoardState }>(decisions: readonly Decision[], rows: readonly Row[]): { state: BoardState; rows: BoardItem<Row>[] }[] {
  return byState<BoardItem<Row>>([
    ...decisions.map((decision) => ({ kind: "decision", state: decisionState(decision), decision }) as const),
    ...rows.map((row) => ({ kind: "crew", state: row.state, row }) as const),
  ]);
}

/** What waits for the user on one board: how many of its decisions and its crews sit under Needs you. */
export const needsYouSchema = z.object({ decisions: z.number().int().nonnegative(), crews: z.number().int().nonnegative() });
export type NeedsYou = z.infer<typeof needsYouSchema>;

export function needsYou(decisions: readonly Decision[], rows: readonly { state: BoardState }[]): NeedsYou {
  const waiting = boardGroups(decisions, rows).find(({ state }) => state === "needs-you")?.rows ?? [];
  return { decisions: waiting.filter((item) => item.kind === "decision").length, crews: waiting.filter((item) => item.kind === "crew").length };
}
