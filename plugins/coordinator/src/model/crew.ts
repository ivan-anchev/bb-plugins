// A crew: one piece of the work, done by its own child thread of the coordinating thread, on its
// own branch. The plugin's database holds it; bb holds its thread.
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { CoordinatorId, CrewId } from "./role.ts";

type EnvironmentArgs = NewThreadRequest["environment"];

const worktreePlacementSchema = z.object({ kind: z.literal("worktree") });
const providerPlacementSchema = z.object({ kind: z.literal("provider"), environmentProviderId: z.string().min(1) });

/** Where crew_start can ask a crew's thread to run: a fresh worktree on the coordinating thread's machine, or an environment provider such as boat-sandbox. */
export const requestedPlacementSchema = z.discriminatedUnion("kind", [worktreePlacementSchema, providerPlacementSchema]);
export type RequestedPlacement = z.infer<typeof requestedPlacementSchema>;

// why only `type` is checked: the plugin reads nothing inside an environment. bb's composer made
// it, and bb validates it at the spawn.
export const environmentSchema = z.custom<EnvironmentArgs>((value) => z.looseObject({ type: z.string() }).safeParse(value).success, "Expected an environment from bb's composer");

/** Where a crew's thread runs: as crew_start asked, or the environment the user chose in the draft editor. */
export const placementSchema = z.discriminatedUnion("kind", [
  worktreePlacementSchema,
  providerPlacementSchema,
  z.object({ kind: z.literal("chosen"), environment: environmentSchema }),
]);
export type Placement = z.infer<typeof placementSchema>;

/** The environment bb spawns a crew in. `hostId` is the coordinating thread's machine (null: bb's default). */
export function environmentOf(placement: Placement, hostId: string | null): EnvironmentArgs {
  switch (placement.kind) {
    case "worktree":
      return { type: "host", hostId: hostId ?? undefined, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } };
    case "provider":
      return { type: "provider", environmentProviderId: placement.environmentProviderId, inputs: null };
    case "chosen":
      return placement.environment;
    default:
      return placement satisfies never;
  }
}

/** The model a crew runs on, as the user picked it in bb's composer, forwarded to the spawn whole. */
export type Execution = Pick<NewThreadRequest, "providerId" | "model" | "reasoningLevel" | "permissionMode" | "serviceTier" | "sessionOptions" | "executionInputSources">;

// why only these are checked: the draft editor seeds bb's composer with them. The rest goes to the
// spawn unchanged, and bb validates it there.
const executionFieldsSchema = z.looseObject({
  providerId: z.string().min(1),
  model: z.string().min(1),
  reasoningLevel: z.string(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]),
  serviceTier: z.string().optional(),
});
export const executionSchema = z.custom<Execution>((value) => executionFieldsSchema.safeParse(value).success, "Expected the model bb's composer picked");

/** What the crew should do, everything it needs to start without asking. */
export const briefSchema = z.string().trim().min(1).max(20_000);

/** The most done-criteria a crew has, and the most characters in one. */
export const MAX_CRITERIA = 12;
export const MAX_CRITERION_CHARS = 500;

/** What "done" means for a crew: each one checkable by running something. */
export const doneCriteriaSchema = z.array(z.string().trim().min(1).max(MAX_CRITERION_CHARS)).min(1).max(MAX_CRITERIA);

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
  /** Null: the project's default model, with auto permissions. */
  execution: Execution | null;
  /**
   * A draft has no thread yet: it waits for the user's Start, or its spawn never confirmed one.
   * Either way Start spawns it from what is stored.
   */
  launch: { kind: "draft" } | { kind: "started"; threadId: string };
  closed: null | { kind: ClosedKind; at: number };
  createdAt: number;
};

/** What the user changes in a draft, all from bb's composer but the criteria: everything but its title. */
export type DraftEdit = Pick<Crew, "brief" | "doneCriteria"> & { execution: Execution; placement: Extract<Placement, { kind: "chosen" }> };
