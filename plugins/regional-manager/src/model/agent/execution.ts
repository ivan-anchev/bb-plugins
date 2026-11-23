// What a thread the plugin starts runs on: a provider, a model and a reasoning level. The manager
// names one as a request (an agent's on agent_start, an issue's verifier on issue_create and
// issue_update), and it is resolved against bb's catalog where the thread will run, or refused
// with why, as placementOf resolves a placement (agent.ts).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/** What a thread runs on, every field resolved: the three fields bb's spawn takes. why any reasoning level: the string is bb's, and a catalog default may be empty. */
export const executionSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1), reasoningLevel: z.string() });
export type Execution = z.infer<typeof executionSchema>;

/** A provider and model as bb records a thread's turns on them: what a verifier or a reviewer ran on. */
export const modelRefSchema = executionSchema.pick({ providerId: true, model: true });
export type ModelRef = z.infer<typeof modelRefSchema>;

/** What the manager names. why the reasoning level optional: left out, the plugin picks it (pickedReasoningLevel). */
export const requestedExecutionSchema = z.object({
  providerId: z.string().trim().min(1).describe("The provider, as bb lists it: claude-code, codex, pi…"),
  model: z.string().trim().min(1).describe("A model of that provider, as its catalog in bb names it."),
  reasoningLevel: z
    .string()
    .optional()
    .describe("Left out: high; medium on a model that lists no high; the model's default on one that lists neither. A level named, even low, is used as named: name low only for a test or throwaway work."),
});
export type RequestedExecution = z.infer<typeof requestedExecutionSchema>;

/** A model as bb's `providers.models` gives it. */
type SdkCatalogModel = Awaited<ReturnType<BbPluginApi["sdk"]["providers"]["models"]>>["models"][number];

/** A model in a provider's catalog, down to what the plugin reads: the reasoning levels it lists among them, lowest first. */
export type CatalogModel = Pick<SdkCatalogModel, "model" | "isDefault" | "defaultReasoningEffort"> & {
  supportedReasoningEfforts: readonly Pick<SdkCatalogModel["supportedReasoningEfforts"][number], "reasoningEffort">[];
};

/**
 * The reasoning level the plugin runs a model on when nobody names one: high, else the highest
 * level it lists below high (medium), else its default. why not the default first: a Codex model's is low,
 * and the user runs no real work on low. why medium is the only level tried below high: below
 * it is low, and a model that lists nothing above low keeps its default.
 */
export function pickedReasoningLevel({ defaultReasoningEffort, supportedReasoningEfforts }: CatalogModel): string {
  const listed = (level: string) => supportedReasoningEfforts.some(({ reasoningEffort }) => reasoningEffort === level);
  return PICKED_LEVELS.find(listed) ?? defaultReasoningEffort;
}

/** The levels the plugin picks from, best first. */
const PICKED_LEVELS = ["high", "medium"] as const;

/**
 * What bb lists where the thread will run: its providers, and the requested provider's models
 * (none when it isn't listed, or bb can't load them there).
 */
export type ExecutionFacts = { providers: readonly { id: string; available: boolean }[]; models: readonly CatalogModel[] };

/**
 * The execution the manager asked for, or why bb can't run it there: the provider must be listed
 * and available, and the model in its catalog. A reasoning level it names is bb's to judge at the
 * spawn, as every spawn field is. why a refusal names no other provider: knowing which ones run
 * there takes a catalog read of each (catalog.ts resolvedExecution).
 */
export function executionOf(requested: RequestedExecution, { providers, models }: ExecutionFacts): Execution | { refused: string } {
  const { providerId } = requested;
  if (!providers.some(({ id, available }) => id === providerId && available)) return { refused: `bb can't run ${providerId} there.` };
  if (models.length === 0) return { refused: `bb can't load ${providerId}'s models there.` };
  const model = models.find(({ model }) => model === requested.model);
  if (model === undefined) return { refused: `${providerId} has no model ${requested.model} there. Its models: ${models.map(modelText).join(", ")}.` };
  return { providerId, model: model.model, reasoningLevel: requested.reasoningLevel ?? pickedReasoningLevel(model) };
}

/** The providers bb can run somewhere, as a refusal names them: those it lists as available and loads models of there. */
export const runnableText = (runnable: readonly string[]): string => (runnable.length === 0 ? "bb can run no provider there." : `bb can run: ${runnable.join(", ")}.`);

const modelText = ({ model, isDefault }: CatalogModel): string => (isDefault ? `${model} (default)` : model);

/** Whether two threads run on one provider and model. */
export const sameModel = (a: Pick<Execution, "providerId" | "model">, b: Pick<Execution, "providerId" | "model">): boolean => a.providerId === b.providerId && a.model === b.model;

/** Where bb reads a provider catalog (`providers.list` and `providers.models`): an environment, a machine, or neither, which is bb's primary machine. */
export type CatalogRouting = { environmentId: string; hostId?: never } | { hostId: string; environmentId?: never } | { environmentId?: never; hostId?: never };

/**
 * The catalog of the place bb will spawn a thread in: a joined environment's own, a worktree's
 * machine's, and bb's primary machine's for a new sandbox, which has no machine until the spawn.
 */
export function catalogRouting(environment: NewThreadRequest["environment"]): CatalogRouting {
  switch (environment.type) {
    case "reuse":
      return { environmentId: environment.environmentId };
    case "host":
      return environment.hostId === undefined ? {} : { hostId: environment.hostId };
    case "provider":
    case "project-default":
      return {};
    default:
      return environment satisfies never;
  }
}
