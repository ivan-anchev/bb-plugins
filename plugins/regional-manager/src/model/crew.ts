// A crew: one piece of the work, done by its own child thread of the coordinating thread, on its
// own branch. The plugin's database holds it; bb holds its thread.
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { CoordinatorId, CrewId } from "./role.ts";

type EnvironmentArgs = NewThreadRequest["environment"];
type ProviderEnvironment = Extract<EnvironmentArgs, { type: "provider" }>;

const worktreePlacementSchema = z.object({ kind: z.literal("worktree") });

/**
 * Non-secret settings for the machine an environment provider makes, such as boat-sandbox's
 * `{"preset": "small"}`. why scalars only: bb refuses a tool whose parameters' JSON Schema is
 * recursive, as `z.json()` is, and the providers' machine inputs are flat.
 */
const machineInputsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
type MachineInputs = z.infer<typeof machineInputsSchema>;

/** Where crew_start can ask a crew's thread to run: a fresh worktree on the coordinating thread's machine, or an environment provider such as boat-sandbox. */
export const requestedPlacementSchema = z.discriminatedUnion("kind", [
  worktreePlacementSchema,
  z.object({ kind: z.literal("provider"), environmentProviderId: z.string().min(1), machineInputs: machineInputsSchema.optional() }),
]);
export type RequestedPlacement = z.infer<typeof requestedPlacementSchema>;

/** An environment provider as bb lists it (`environments.listProviders`), down to what crew_start reads. */
export type EnvironmentProvider = {
  id: string;
  /** The JSON Schema of its inputs; null: it takes none. */
  inputs: unknown;
  acceptsEmptyInputs: boolean;
  /** The environment provider it composes with a machine of its own, as boat-sandbox composes project-checkout. */
  environmentProviderId?: string;
  machineProviderId: string | null;
  /** The JSON Schema of its machine's inputs; null: they take none; absent: it makes no machine. */
  machineInputs?: unknown;
  machineAcceptsEmptyInputs?: boolean;
};

/** What bb tells crew_start about where a crew can run: its environment providers, and the project's default branch (null: bb records none). */
export type PlacementFacts = { providers: readonly EnvironmentProvider[]; defaultBranch: string | null };

/** bb's environment provider of a checkout of the project, which takes the branch to check out. */
const PROJECT_CHECKOUT = "project-checkout";

/**
 * Where to spawn what crew_start asked, or why bb can't run it there. A provider is resolved to
 * the environment bb spawns in, by bb's own rule for a spawn on one (as `bb thread spawn
 * --environment-provider` applies it): inputs it takes are `{}`, its defaults, and a provider that
 * makes its own machine gets a new one with the machine inputs crew_start named, else `{}`. A
 * project checkout on a new machine also gets a new branch from the default one, as a worktree
 * crew does, so the crew works on its own branch from the start.
 */
export function placementOf(requested: RequestedPlacement, { providers, defaultBranch }: PlacementFacts): Placement | { refused: string } {
  if (requested.kind === "worktree") return requested;
  const { environmentProviderId, machineInputs } = requested;
  const provider = providers.find(({ id }) => id === environmentProviderId);
  if (provider === undefined) return { refused: `bb has no environment provider ${environmentProviderId}. It has: ${providers.map(({ id }) => id).join(", ")}.` };
  if (provider.inputs !== null && !provider.acceptsEmptyInputs) return { refused: `${environmentProviderId} needs inputs crew_start can't give it. The user can pick it in a draft's editor.` };
  const machine = machineOf(provider, machineInputs);
  if (machine !== null && "refused" in machine) return machine;
  // The branch the crew's own branch starts from; undefined: the provider makes none.
  const baseBranch = machine !== null && provider.environmentProviderId === PROJECT_CHECKOUT ? defaultBranch : undefined;
  if (baseBranch === null) return { refused: "bb records no default branch for this project, so the crew's branch can't be made from it. Use a worktree placement." };
  const inputs: ProviderEnvironment["inputs"] = provider.inputs === null ? null : baseBranch === undefined ? {} : { branch: { kind: "new", baseBranch } };
  return { kind: "chosen", environment: { type: "provider", environmentProviderId, inputs, ...(machine && { machine: { type: "new", ...machine } }) } };
}

/** The new machine a provider makes for the crew, with the inputs crew_start named; null when it makes none that takes inputs. */
function machineOf(
  { id, machineProviderId, machineInputs: takes, machineAcceptsEmptyInputs }: EnvironmentProvider,
  inputs: MachineInputs | undefined,
): { machineProviderId: string; inputs: MachineInputs } | null | { refused: string } {
  if (machineProviderId === null || takes === undefined || takes === null) {
    return inputs === undefined ? null : { refused: `${id} makes no machine that takes inputs, so leave out machineInputs.` };
  }
  if (inputs === undefined && machineAcceptsEmptyInputs !== true) return { refused: `${id} needs machineInputs: \`bb environment providers --json\` shows what its machine takes.` };
  return { machineProviderId, inputs: inputs ?? {} };
}

// why only `type` is checked: the plugin reads nothing inside an environment. bb's composer made
// it, or placementOf did from bb's provider list, and bb validates it at the spawn.
export const environmentSchema = z.custom<EnvironmentArgs>((value) => z.looseObject({ type: z.string() }).safeParse(value).success, "Expected an environment from bb's composer");

/**
 * Where a crew's thread runs: a fresh worktree on the coordinating thread's machine, or the
 * environment bb spawns it in, as the user chose it in the draft editor or as crew_start's
 * provider placement resolved to.
 */
export const placementSchema = z.discriminatedUnion("kind", [worktreePlacementSchema, z.object({ kind: z.literal("chosen"), environment: environmentSchema })]);
export type Placement = z.infer<typeof placementSchema>;

/** The environment bb spawns a crew in. `hostId` is the coordinating thread's machine (null: bb's default). */
export function environmentOf(placement: Placement, hostId: string | null): EnvironmentArgs {
  switch (placement.kind) {
    case "worktree":
      return { type: "host", hostId: hostId ?? undefined, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } };
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
  /** Null: its coordinating thread's provider and model when it starts, with auto permissions. */
  execution: Execution | null;
  /**
   * A draft has no thread yet: it waits for the user's Start, or its spawn never confirmed one.
   * Either way Start spawns it from what is stored.
   */
  launch: { kind: "draft" } | { kind: "started"; threadId: string };
  closed: null | { kind: ClosedKind; at: number };
  /** The branch its thread had checked out at its latest handoff, as bb's git plugin read it then; null: none read yet. */
  branch: string | null;
  /** How many failed verdicts the plugin has sent back to it to fix, without its coordinating thread. */
  fixRounds: number;
  createdAt: number;
};

/**
 * The branch a crew works on: the one its thread had checked out at its latest handoff, else the
 * one bb records for its environment, which bb made it on (null: neither). why never read live: a
 * crew in a sandbox would be woken, or kept awake, by every read.
 */
export const branchOf = (crew: Pick<Crew, "branch">, thread: { environmentBranchName: string | null }): string | null => crew.branch ?? thread.environmentBranchName;

/** Each crew's title by its id, as the coordinating thread gave it in crew_start. */
export const titlesOf = (crews: readonly Crew[]): ReadonlyMap<CrewId, string> => new Map(crews.map((crew) => [crew.id, crew.title]));

/** What the user changes in a draft, all from bb's composer but the criteria: everything but its title. */
export type DraftEdit = Pick<Crew, "brief" | "doneCriteria"> & { execution: Execution; placement: Extract<Placement, { kind: "chosen" }> };
