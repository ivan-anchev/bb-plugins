// A crew: one piece of the work, done by its own child thread of the coordinating thread, on its
// own branch. The plugin's database holds it; bb holds its thread.
import { z } from "zod";
import type { CoordinatorId, CrewId } from "./role.ts";

/** Where a crew's thread runs: a fresh worktree on the coordinating thread's machine, or an environment provider such as boat-sandbox. */
export const placementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("worktree") }),
  z.object({ kind: z.literal("provider"), environmentProviderId: z.string().min(1) }),
]);
export type Placement = z.infer<typeof placementSchema>;

/** What "done" means for a crew: each one checkable by running something. */
export const doneCriteriaSchema = z.array(z.string().trim().min(1).max(500)).min(1).max(12);

/** How a crew was closed: resolved (its work is accepted), archived, or stopped. */
export const closedKindSchema = z.enum(["resolved", "archived", "stopped"]);
export type ClosedKind = z.infer<typeof closedKindSchema>;

export type Crew = {
  id: CrewId;
  coordinatorId: CoordinatorId;
  title: string;
  brief: string;
  doneCriteria: string[];
  placement: Placement;
  /** A draft has no thread yet: its spawn never confirmed one. */
  launch: { kind: "draft" } | { kind: "started"; threadId: string };
  closed: null | { kind: ClosedKind; at: number };
  createdAt: number;
};
