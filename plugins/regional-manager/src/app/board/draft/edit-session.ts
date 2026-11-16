// An edit of a draft in progress: open from Edit until Save or Cancel ends it. It is stored outside
// the editor, so it outlives a remount and a reload, and it keeps the draft it started from, so a
// draft saved elsewhere meanwhile shows beside the edit instead of either one being lost.
import { z } from "zod";
import { draftSchema, type Draft } from "../../../contract.ts";
import type { CoordinatorId, CrewId } from "../../../model/role.ts";
import { fieldsOf } from "./criteria.ts";

export const editSessionSchema = z.object({
  /** When Edit opened it; it names the composer's draft, so each edit starts from what is stored. */
  openedAt: z.number(),
  /** The draft as Edit found it: the composer's seed, and what a later read is checked against. */
  base: draftSchema,
  criteria: z.array(z.object({ key: z.number(), text: z.string() })),
});
export type EditSession = z.infer<typeof editSessionSchema>;

/** A draft that moved on under an edit, and which of its parts did. */
export type Newer = { draft: Draft; changed: DraftPart[] };
type DraftPart = "brief" | "done-criteria" | "model" | "environment";

export function opened(draft: Draft, now: number): EditSession {
  return { openedAt: now, base: draft, criteria: fieldsOf(draft.doneCriteria) };
}

/** Where a crew's edit is stored. */
export const storageKeyOf = (coordinatorId: CoordinatorId, crewId: CrewId): string => `coordinator-draft-edit:${coordinatorId}:${crewId}`;

/** Where bb's composer keeps the edit's brief, model and environment. */
export const composerKeyOf = (coordinatorId: CoordinatorId, crewId: CrewId, session: EditSession): string =>
  `coordinator-draft:${coordinatorId}:${crewId}:${session.openedAt}`;

/** The draft as read now, when it is no longer the one the edit started from. */
export function newerOf(session: EditSession, draft: Draft): Newer | null {
  const { base } = session;
  const changed = (
    [
      ["brief", base.brief === draft.brief],
      ["done-criteria", same(base.doneCriteria, draft.doneCriteria)],
      ["model", same(base.execution, draft.execution)],
      ["environment", same(base.environment, draft.environment) && base.projectId === draft.projectId],
    ] satisfies [DraftPart, boolean][]
  ).flatMap(([part, kept]) => (kept ? [] : [part]));
  return changed.length === 0 ? null : { draft, changed };
}

// why JSON: both sides are parsed from the same server's JSON, whose key order a round trip keeps.
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
