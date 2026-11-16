// Where a crew sits on the board, and the one line that says why. Pure, so the board and
// crew_catch_up share one definition. Every headline comes from facts; no model call.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { Crew } from "../crew.ts";
import type { Handoff } from "../handoff.ts";
import type { CiVerdict, PrSnapshot } from "../verdict/pr.ts";
import { allPassed, ciVerdictOf, mayHaveReachedCrew, outcome, type Verdict } from "../verdict/verdict.ts";

/** The board's groups, in the order it shows them. */
export const boardStateSchema = z.enum(["needs-you", "ready-for-review", "verifying", "working", "landing", "idle", "done"]);
export type BoardState = z.infer<typeof boardStateSchema>;

/** Each group's name, as the board and crew_catch_up show it. */
export const BOARD_STATE_LABELS: Record<BoardState, string> = {
  "needs-you": "Needs you",
  "ready-for-review": "Ready for review",
  verifying: "Verifying",
  working: "Working",
  landing: "Landing",
  idle: "Idle",
  done: "Done",
};

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

/**
 * `thread` is null when bb no longer lists it: archived or deleted. `handoff` is the crew's current
 * handoff (see handoffIsCurrent), null when it has none. `pr` is its pull request as last read
 * (null: none seen). why a merged one first: its work has landed, whatever its thread does next.
 */
export function crewState(crew: Crew, thread: CrewThread | null, handoff: Handoff | null, pr: PrSnapshot | null): { state: BoardState; headline: string } {
  if (crew.closed !== null) return { state: "done", headline: CLOSED[crew.closed.kind] };
  if (crew.launch.kind === "draft") return { state: "needs-you", headline: `Draft: ${crew.title}` };
  if (pr?.state === "merged") return { state: "done", headline: `Merged #${pr.number}` };
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
      return handoff === null ? IDLE : handedOff(handoff, crew.fixRounds, pr);
    default:
      // why not throw: bb can send a status newer than this plugin's SDK. A thread in it is not
      // known to be working, so it shows as idle until bb says otherwise.
      thread.status satisfies never;
      return IDLE;
  }
}

const IDLE = { state: "idle", headline: "Its turn ended without a handoff" } as const;

function handedOff(handoff: Handoff, fixRounds: number, pr: PrSnapshot | null): { state: BoardState; headline: string } {
  switch (handoff.status) {
    case "blocked":
      return { state: "needs-you", headline: `Blocked: ${handoff.summary}` };
    case "gave-up":
      return { state: "needs-you", headline: `Gave up: ${handoff.summary}` };
    case "done":
      return checked(handoff.summary, handoff.verdict, pr, failureNote(handoff.verdict, fixRounds));
    default:
      return handoff satisfies never;
  }
}

/**
 * What a failure's headline adds about the crew's fix round: that this verdict's findings may or
 * may not have reached it, or that it failed again after them. why `fixRounds`: a failure that
 * reaches the board after the crew's findings went back to it once is not its first.
 */
function failureNote(verdict: Verdict, fixRounds: number): string {
  if (mayHaveReachedCrew(verdict)) return ", its findings may or may not have reached it";
  return fixRounds > 0 ? " after its fix round" : "";
}

/**
 * A done handoff, placed by its verdict, with `failureNote` added to a failure. Work that passed, or
 * that nobody checks, is Landing while its pull request is open, else Ready for review. The board
 * never reads the switch: a handoff keeps the verdict it was made with.
 */
function checked(summary: string, verdict: Verdict, pr: PrSnapshot | null, failureNote: string): { state: BoardState; headline: string } {
  const result = outcome(verdict);
  const ready = (headline: string) => ({ state: pr?.state === "open" ? "landing" : "ready-for-review", headline }) as const;
  switch (result) {
    case "pending":
      return { state: "verifying", headline: `Verifying: ${summary}` };
    case "waiting-for-ci":
      return { state: "verifying", headline: `Waiting for CI${pr === null ? "" : ` on #${pr.number}`}: ${summary}` };
    case "pass":
      return ready(`✓ Verified${passNote(ciOfReturned(verdict))}: ${summary}`);
    case "fail":
      return { state: "needs-you", headline: `${failedAs(verdict)}${failureNote}: ${summary}` };
    case "could-not-run":
      return { state: "needs-you", headline: `Couldn't verify: ${summary}` };
    case "unverified":
      return ready(`Unverified: ${summary}`);
    case "superseded":
      // why idle: only an earlier handoff is ever replaced, and the board shows a crew's latest. Nothing checks it, so it is not ready.
      return { state: "idle", headline: `Replaced by a newer handoff: ${summary}` };
    default:
      return result satisfies never;
  }
}

/** What a pass says of CI on its commit when CI didn't pass there: it couldn't be checked, or GitHub reported no checks. */
function passNote(ci: CiVerdict | null): string {
  if (ci?.kind === "not-checked") return ", CI not checked";
  return ci?.kind === "no-checks" ? ", no CI checks" : "";
}

/** What CI said about a settled verdict's commit; null for any other verdict. */
const ciOfReturned = (verdict: Verdict) => (verdict.state === "returned" ? ciVerdictOf(verdict) : null);

/** How a failure reads: as CI's, when every criterion passed and CI failed on the commit. */
function failedAs(verdict: Verdict): string {
  const ci = ciOfReturned(verdict);
  return ci?.kind === "fail" && verdict.state === "returned" && allPassed(verdict) ? `✗ CI failed on #${ci.number}` : "✗ Failed verification";
}

const CLOSED: Record<NonNullable<Crew["closed"]>["kind"], string> = {
  resolved: "Resolved",
  archived: "Archived",
  stopped: "Stopped",
};
