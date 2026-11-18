// An agent: one child thread the regional manager started, holding exactly one issue for its whole
// life. One agent is one assignment, so there is no separate assignment row. The plugin's database
// holds it; bb holds its thread.
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { Execution } from "./execution.ts";
import type { HandoffId } from "./handoff.ts";
import type { IssueId } from "./issue/issue.ts";
import { shipsCode, type Kind } from "./issue/kind.ts";
import type { CoordinatorId } from "./role.ts";
import type { CheckoutRead } from "./verdict/checkout.ts";
import type { PrRead } from "./verdict/pr.ts";

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

/**
 * The environment bb spawns an agent in. `hostId` is the regional manager's machine (null: bb's
 * default); `ref`, the branch bb cuts the agent's own branch from (null: the default branch). why a
 * branch name, never a commit: bb fetches `origin/<branch>` before cutting from it, and never fetches
 * a commit (bb-facts P1b, P2).
 */
export function environmentOf(placement: Placement, hostId: string | null, ref: string | null): EnvironmentArgs {
  switch (placement.kind) {
    case "worktree":
      return { type: "host", hostId: hostId ?? undefined, workspace: { type: "managed-worktree", baseBranch: ref === null ? { kind: "default" } : { kind: "named", name: ref } } };
    case "provider": {
      const { environmentProviderId, inputs, machine } = placement;
      return { type: "provider", environmentProviderId, inputs: inputsOf(inputs, ref), ...(machine && { machine: { type: "new", ...machine } }) };
    }
    default:
      return placement satisfies never;
  }
}

/** A provider's inputs at the spawn; a new branch is cut from `ref` when one is named. */
function inputsOf(inputs: ProviderInputs, ref: string | null): Extract<EnvironmentArgs, { type: "provider" }>["inputs"] {
  switch (inputs.kind) {
    case "none":
      return null;
    case "defaults":
      return {};
    case "new-branch":
      return { branch: { kind: "new", baseBranch: ref ?? inputs.baseBranch } };
    default:
      return inputs satisfies never;
  }
}

/**
 * Where an agent's work starts. `default`: a new branch from the project's default branch.
 * `joined`: in `from`'s environment, on the branch checked out there, with its commits, its
 * uncommitted files and its pull request (sandbox-handover SH1). `cut`: in a new environment, on a
 * new branch bb cut from `from`'s `branch`, `via` origin's copy, once a pull request showed `head`
 * there, or the local branch, which a worktree on the same machine reaches; `head`, the commit
 * `from` left on it as last seen (null: none known), which the new agent checks it got. why a
 * check: bb cuts after the spawn answers, and a branch can move until then.
 */
export const baseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("default") }),
  z.object({ kind: z.literal("joined"), from: agentIdSchema }),
  z.object({ kind: z.literal("cut"), from: agentIdSchema, branch: z.string().min(1), via: z.enum(["local", "origin"]), head: z.string().min(1).nullable() }),
]);
export type Base = z.infer<typeof baseSchema>;
type Cut = Extract<Base, { kind: "cut" }>;

/** The ref bb cuts a cut agent's branch from: `origin/<branch>`, or the local `<branch>`. */
export const refOf = ({ branch, via }: Pick<Cut, "branch" | "via">): string => (via === "origin" ? `origin/${branch}` : branch);

/**
 * Where the agent's work was last seen: its environment, the branch checked out there and its
 * commit, as bb's git plugin read them at its latest handoff, or as a joined agent inherited them
 * (null for each not known yet). why stored: reading them at any other time could wake an agent's
 * sandbox.
 */
export type AgentCheckout = { environmentId: string | null; branch: string | null; head: string | null };

/** How an agent stopped holding its issue. `replaced`: a handover gave its issue to a new agent. `spawn-failed`: bb never confirmed its thread. */
export const endedHowSchema = z.enum(["stopped", "archived", "deleted", "replaced", "spawn-failed"]);
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

/** The agent holding the issue now, among a regional manager's agents: the one not ended (null: none). */
export const holderOf = <A extends Pick<Agent, "issueId" | "ended">>(agents: readonly A[], issueId: IssueId): A | null =>
  agents.find((agent) => agent.issueId === issueId && agent.ended === null) ?? null;

/** What agent_start asks of an issue that had an agent: `previous` continues its work, `default` starts clean. */
export const startFromSchema = z.enum(["previous", "default"]);
export type StartFrom = z.infer<typeof startFromSchema>;

/**
 * The issue's previous agent as a handover finds it, before anything changes: its environment while
 * bb hasn't destroyed it (null: destroyed, or never known), and its branch (null: none on record).
 * For a move only, read once: `now`, its live environment as bb's git plugin read it, the branch
 * checked out there with its head and changed files, and `pushed`, the cut's branch's pull request
 * as GitHub had it, when the cut goes through origin (null: not read).
 */
export type Previous = { agent: Agent; environmentId: string | null; branch: string | null; now: CheckoutRead | null; pushed: PrRead | null };

/**
 * Where a new agent starts. `clean`: where agent_start's placement says, from the default branch, as
 * a first agent does. `join`: in the previous agent's environment, which bb reuses as it does for a
 * verifier, with its checkout inherited. `cut`: in a new environment of `placement`, on a new branch
 * cut from the previous agent's.
 */
export type Handover =
  | { kind: "clean" }
  | { kind: "join"; base: Extract<Base, { kind: "joined" }>; placement: Placement; environment: EnvironmentArgs; checkout: AgentCheckout }
  | { kind: "cut"; base: Cut; placement: Placement };

/** What agent_start asked of a handover: `from`, and the placement it named, resolved (null: none named). */
type HandoverRequest = { from: StartFrom; placement: Placement | null };

/** Whether a start is clean whatever came before: `from: "default"`, or a kind that ships no code, whose work is its report and reaches the new agent in its first message. */
export const startsClean = (kind: Kind, from: StartFrom): boolean => from === "default" || !shipsCode(kind);

/**
 * Where an agent of a `kind` issue starts, or why it can't, decided before anything changes (pure).
 * Clean: no earlier agent with a thread, or startsClean. Continue: nothing named and the previous
 * environment still there, whatever runs it, idle, stopped, archived within a worktree's grace or
 * suspended, which the spawn wakes (SH1, SH5). Move: a placement named, or the environment gone; the
 * work goes to a new environment on a branch cut from the previous agent's (cutRef).
 */
export function handoverOf(kind: Kind, request: HandoverRequest, previous: Previous | null): Handover | { refused: string } {
  if (previous === null || startsClean(kind, request.from)) return { kind: "clean" };
  const { agent, environmentId, branch } = previous;
  const to = moveTo(request.placement, previous);
  if (to === null && environmentId !== null) {
    return {
      kind: "join",
      base: { kind: "joined", from: agent.id },
      placement: agent.placement,
      environment: { type: "reuse", environmentId },
      checkout: { environmentId, branch, head: agent.checkout.head },
    };
  }
  const cut = cutRef(previous, to ?? agent.placement);
  return "refused" in cut ? cut : { kind: "cut", base: cut, placement: to ?? agent.placement };
}

/**
 * Where a handover moves the work: the placement named; else, once bb destroyed the previous
 * environment, a new one like it, a sandbox of the same provider and machine inputs (a sandbox goes
 * at its last thread's archive, SH5; a worktree a few minutes after, SH1). null: it continues.
 */
export const moveTo = (named: Placement | null, { agent, environmentId }: Pick<Previous, "agent" | "environmentId">): Placement | null =>
  named ?? (environmentId === null ? agent.placement : null);

/** The branch a move cuts from, and the head the previous agent left there (null: none known). */
type Tip = { branch: string; head: string | null };

/**
 * How a move of the previous agent's work to `to` gets its branch, from what the move read
 * (`pushed` aside): from the local branch, as a cut; once its pull request shows the head pushed
 * (`prove`: the branch, and the head to find there, null when none is known); or why it can't,
 * naming the fact behind it and a start that does work. Every refusal comes first, in this order.
 */
export function cutPlan(previous: Omit<Previous, "pushed">, to: Placement): Cut | { prove: Tip } | { refused: string } {
  const { agent, environmentId } = previous;
  const orContinue = environmentId !== null ? "continue in its environment (leave out placement), or " : "";
  if (to.kind === "provider" && to.inputs.kind !== "new-branch") return { refused: `${to.environmentProviderId} takes no branch, so an agent there can't start from ${agent.id}'s: ${orContinue}${CLEAN}` };
  const tip = tipOf(previous);
  if ("refused" in tip) return tip;
  // A worktree's branch is a ref of the project's repository on the regional manager's machine: a new
  // worktree there cuts from it while its agent lives, after it is archived, and after its worktree
  // is removed (bb-facts P1a, P1b(i), P1c).
  if (to.kind === "worktree" && agent.placement.kind === "worktree") return { kind: "cut", from: agent.id, ...tip, via: "local" };
  // Anything else reaches the branch only through origin: a sandbox clones from it (SH2), a worktree
  // fetches `origin/<branch>` (P2), and bb puts a sandbox's branch there only if something in the
  // sandbox pushes it (SH4).
  return { prove: tip };
}

/**
 * Where the previous agent's work is, for a move: in a live environment, the branch checked out and
 * its head, as the one read just made shows them together; once bb destroyed it, the branch on record
 * and the head its last handoff recorded. Or why there is none to cut from. why the live branch: an
 * agent may have checked out another, and committed there. The graft: a new environment gets
 * committed work alone, so what a live one holds uncommitted would stay behind; a continue inherits it.
 */
function tipOf({ agent, environmentId, branch, now }: Omit<Previous, "pushed">): Tip | { refused: string } {
  if (environmentId === null) {
    return branch === null ? { refused: `${agent.id} has no branch on record, so a new environment has nothing to start from: ${CLEAN}` } : { branch, head: agent.checkout.head };
  }
  if (now?.kind !== "read") {
    const why = now === null ? "it wasn't read" : now.reason;
    return { refused: `bb's git plugin can't read ${agent.id}'s environment now (${why}), so what ${agent.id} left uncommitted there is unknown. Continue in it instead (leave out placement; that wakes a sleeping sandbox), or call again once it can be read.` };
  }
  if (now.branch === null) {
    return { refused: `${agent.id}'s environment has no branch checked out (HEAD is detached at ${now.checkout.headSha.slice(0, 7)}), so a new environment has none to start from. Continue in it (leave out placement), or ask ${agent.id} to check out a branch with its commits, then call again.` };
  }
  if (now.checkout.changedFileCount > 0) {
    return { refused: `${agent.id} left ${uncommittedText(now.checkout)} in its environment, which a new environment wouldn't get. Continue in it (leave out placement), or ask ${agent.id} to commit them, then call again.` };
  }
  return { branch: now.branch, head: now.checkout.headSha };
}

/**
 * The cut a move makes, or why it can't (pure; cutPlan's order): through origin only once the
 * branch's pull request has the head the agent left (tipOf), which proves it pushed (SH4).
 */
function cutRef(previous: Previous, to: Placement): Cut | { refused: string } {
  const plan = cutPlan(previous, to);
  if (!("prove" in plan)) return plan;
  const { agent, environmentId, pushed } = previous;
  const { branch, head } = plan.prove;
  if (head !== null && pushed?.kind === "read" && pushed.pr?.headSha === head) return { kind: "cut", from: agent.id, branch, via: "origin", head };
  const at = head === null ? "the head it left" : `its head ${head.slice(0, 7)}`;
  if (pushed?.kind === "unread") {
    const then = environmentId === null ? `Call again once GitHub can be read, or ${CLEAN}` : "Continue in its environment (leave out placement), or call again once GitHub can be read.";
    return { refused: `Whether ${agent.id}'s branch \`${branch}\` is on origin at ${at} can't be read now: ${pushed.reason}. ${then}` };
  }
  const reaches = "a move with a sandbox on either side reaches the branch only through origin, and only a pull request whose head is that commit shows it was pushed";
  if (environmentId !== null) {
    return { refused: `${agent.id}'s branch \`${branch}\` isn't shown on origin at ${at}: ${reaches}. Continue in its environment (leave out placement), or ask ${agent.id} to push and open a pull request, then call again.` };
  }
  const removed = `bb removed ${agent.id}'s ${placementName(agent.placement)}, and nothing shows its branch \`${branch}\` reached origin at ${at} (no pull request has that head)`;
  return { refused: `${removed}: ${keptText(agent.placement)}` };
}

/** What became of a removed environment's unpushed commits, and the start that works from there. */
function keptText(placement: Placement): string {
  switch (placement.kind) {
    // A worktree's branch outlives it (bb-facts P1c).
    case "worktree":
      return `its commits are still on that branch on your machine, which a new worktree reaches. Leave out placement, or name a worktree, and the new agent starts on a branch cut from it; it can push and open its pull request, and a move to a sandbox works after that. Or ${CLEAN}`;
    case "provider":
      return `its unpushed commits went with it. ${CLEAN.charAt(0).toUpperCase()}${CLEAN.slice(1)}`;
    default:
      return placement satisfies never;
  }
}

const CLEAN = `start clean with from: "default", which starts from the default branch with every earlier handoff and verdict in the new agent's first message.`;

/** Changed files as read, in words: `2 files uncommitted (?? a.txt,  M b.ts)`. */
function uncommittedText({ changedFiles, changedFileCount }: { changedFiles: readonly string[]; changedFileCount: number }): string {
  const more = changedFileCount - changedFiles.length;
  return `${changedFileCount === 1 ? "1 file" : `${changedFileCount} files`} uncommitted (${changedFiles.join(", ")}${more > 0 ? `, and ${more} more` : ""})`;
}

/** What made an environment, in words: `worktree`, `boat-sandbox environment`. */
export const placementName = (placement: Placement): string => (placement.kind === "worktree" ? "worktree" : `${placement.environmentProviderId} environment`);

/**
 * An issue's branch: that of its latest agent with one (`own`: its agents in the order started;
 * `threadOf`: each one's thread as bb lists it, null for none), with that agent; null when none has
 * one. Its pull request is the issue's, read on it. why not the latest agent alone: one whose spawn
 * failed has no branch, and the work before it still has its pull request.
 */
export function issueBranch<A extends Pick<Agent, "checkout">>(own: readonly A[], threadOf: (agent: A) => { environmentBranchName: string | null } | null): { agent: A; branch: string } | null {
  for (const agent of [...own].reverse()) {
    const branch = branchOf(agent, threadOf(agent));
    if (branch !== null) return { agent, branch };
  }
  return null;
}
