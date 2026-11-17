// An agent: one child thread the regional manager started, holding exactly one issue for its whole
// life. One agent is one assignment, so there is no separate assignment row. The plugin's database
// holds it; bb holds its thread.
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { Execution } from "./execution.ts";
import type { HandoffId } from "./handoff.ts";
import type { IssueId } from "./issue/issue.ts";
import type { CoordinatorId } from "./role.ts";

type EnvironmentArgs = NewThreadRequest["environment"];

/** An agent's id within its regional manager: `a1`, `a2`… in the order they were started, never reused. */
export const agentIdSchema = z.string().regex(/^a[1-9][0-9]*$/, "An agent id is a1, a2 and so on").brand<"agentId">();
export type AgentId = z.infer<typeof agentIdSchema>;

const worktreePlacementSchema = z.object({ kind: z.literal("worktree") });

/**
 * Non-secret settings for the machine an environment provider makes, such as boat-sandbox's
 * `{"preset": "small"}`. why scalars only: bb refuses a tool whose parameters' JSON Schema is
 * recursive, as `z.json()` is, and the providers' machine inputs are flat.
 */
const machineInputsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
type MachineInputs = z.infer<typeof machineInputsSchema>;

/** Where agent_start can ask an agent's thread to run: a fresh worktree on the regional manager's machine, or an environment provider such as boat-sandbox. */
export const requestedPlacementSchema = z.discriminatedUnion("kind", [
  worktreePlacementSchema,
  z.object({ kind: z.literal("provider"), environmentProviderId: z.string().min(1), machineInputs: machineInputsSchema.optional() }),
]);
export type RequestedPlacement = z.infer<typeof requestedPlacementSchema>;

/** An environment provider as bb lists it (`environments.listProviders`), down to what agent_start reads. */
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

/** What bb tells agent_start about where an agent can run: its environment providers, and the project's default branch (null: bb records none). */
export type PlacementFacts = { providers: readonly EnvironmentProvider[]; defaultBranch: string | null };

/** bb's environment provider of a checkout of the project, which takes the branch to check out. */
const PROJECT_CHECKOUT = "project-checkout";

/**
 * What a provider's inputs are at the spawn: none, as it takes none; its defaults (`{}`); or a new
 * branch from `baseBranch`, for a project checkout on a new machine, so the agent works on its own
 * branch from the start, as a worktree agent does.
 */
const providerInputsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("defaults") }),
  z.object({ kind: z.literal("new-branch"), baseBranch: z.string().min(1) }),
]);
type ProviderInputs = z.infer<typeof providerInputsSchema>;

/**
 * Where an agent's thread runs, resolved once by placementOf from bb's provider list: a fresh
 * worktree on the regional manager's machine, or a provider's environment, with the new machine
 * it makes for the agent (null: it makes none that takes inputs).
 */
export const placementSchema = z.discriminatedUnion("kind", [
  worktreePlacementSchema,
  z.object({
    kind: z.literal("provider"),
    environmentProviderId: z.string().min(1),
    inputs: providerInputsSchema,
    machine: z.object({ machineProviderId: z.string().min(1), inputs: machineInputsSchema }).nullable(),
  }),
]);
export type Placement = z.infer<typeof placementSchema>;

/**
 * Where to spawn what agent_start asked, or why bb can't run it there. A provider is resolved by
 * bb's own rule for a spawn on one (as `bb thread spawn --environment-provider` applies it): inputs
 * it takes are its defaults, and a provider that makes its own machine gets a new one with the
 * machine inputs agent_start named, else `{}`.
 */
export function placementOf(requested: RequestedPlacement, { providers, defaultBranch }: PlacementFacts): Placement | { refused: string } {
  if (requested.kind === "worktree") return requested;
  const { environmentProviderId, machineInputs } = requested;
  const provider = providers.find(({ id }) => id === environmentProviderId);
  if (provider === undefined) return { refused: `bb has no environment provider ${environmentProviderId}. It has: ${providers.map(({ id }) => id).join(", ")}.` };
  if (provider.inputs !== null && !provider.acceptsEmptyInputs) return { refused: `${environmentProviderId} needs inputs agent_start can't give it.` };
  const machine = machineOf(provider, machineInputs);
  if (machine !== null && "refused" in machine) return machine;
  // The branch the agent's own branch starts from; undefined: the provider makes none.
  const baseBranch = machine !== null && provider.environmentProviderId === PROJECT_CHECKOUT ? defaultBranch : undefined;
  if (baseBranch === null) return { refused: "bb records no default branch for this project, so the agent's branch can't be made from it. Use a worktree placement." };
  const inputs: ProviderInputs = provider.inputs === null ? { kind: "none" } : baseBranch === undefined ? { kind: "defaults" } : { kind: "new-branch", baseBranch };
  return { kind: "provider", environmentProviderId, inputs, machine };
}

/** The new machine a provider makes for the agent, with the inputs agent_start named; null when it makes none that takes inputs. */
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

/** The environment bb spawns an agent in. `hostId` is the regional manager's machine (null: bb's default). */
export function environmentOf(placement: Placement, hostId: string | null): EnvironmentArgs {
  switch (placement.kind) {
    case "worktree":
      return { type: "host", hostId: hostId ?? undefined, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } };
    case "provider": {
      const { environmentProviderId, inputs, machine } = placement;
      return { type: "provider", environmentProviderId, inputs: inputsOf(inputs), ...(machine && { machine: { type: "new", ...machine } }) };
    }
    default:
      return placement satisfies never;
  }
}

function inputsOf(inputs: ProviderInputs): Extract<EnvironmentArgs, { type: "provider" }>["inputs"] {
  switch (inputs.kind) {
    case "none":
      return null;
    case "defaults":
      return {};
    case "new-branch":
      return { branch: { kind: "new", baseBranch: inputs.baseBranch } };
    default:
      return inputs satisfies never;
  }
}

/** Where an agent's work starts. `default`: a new branch from the project's default branch. */
export const baseSchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("default") })]);
export type Base = z.infer<typeof baseSchema>;

/**
 * Where the agent's work was last seen: its environment, the branch checked out there and its
 * commit, as bb's git plugin read them at its latest handoff (null for each not read yet). why
 * stored: reading them at any other time could wake an agent's sandbox.
 */
export type AgentCheckout = { environmentId: string | null; branch: string | null; head: string | null };

/** How an agent stopped holding its issue. `spawn-failed`: bb never confirmed its thread. */
export const endedHowSchema = z.enum(["stopped", "archived", "deleted", "spawn-failed"]);
export type EndedHow = z.infer<typeof endedHowSchema>;

export type Agent = {
  id: AgentId;
  coordinatorId: CoordinatorId;
  issueId: IssueId;
  placement: Placement;
  base: Base;
  /** What its thread runs on: resolved at its start, refreshed from its thread at each handoff. */
  execution: Execution;
  /** null: bb hasn't confirmed its spawn yet. */
  threadId: string | null;
  checkout: AgentCheckout;
  /** How many failed verdicts the plugin sent back to it to fix, without its regional manager. */
  fixRounds: number;
  startedAt: number;
  /** `left`: its current handoff when it ended, which can still place its issue (status.ts placedByLeft). */
  ended: null | { how: EndedHow; at: number; left: HandoffId | null };
};

/**
 * The branch an agent works on: the one its thread had checked out at its latest handoff, else the
 * one bb records for its environment, which bb made it on (null: neither, or bb lists no thread).
 * why never read live: an agent in a sandbox would be woken, or kept awake, by every read.
 */
export const branchOf = (agent: Pick<Agent, "checkout">, thread: { environmentBranchName: string | null } | null): string | null =>
  agent.checkout.branch ?? thread?.environmentBranchName ?? null;
