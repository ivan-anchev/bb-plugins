// What a thread the plugin starts runs on: a provider, a model and a reasoning level. The manager
// names one as a request (an agent's on agent_start, an issue's verifier on issue_create and
// issue_update), and it is resolved against bb's catalog where the thread will run, or refused
// with what bb can run there, as placementOf resolves a placement (agent.ts).
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/** What a thread runs on, every field resolved: the three fields bb's spawn takes. why any reasoning level: the string is bb's, and a catalog default may be empty. */
export const executionSchema = z.object({ providerId: z.string().min(1), model: z.string().min(1), reasoningLevel: z.string() });
export type Execution = z.infer<typeof executionSchema>;

/** What the manager names. why the reasoning level optional: left out, it is the model's default in bb's catalog. */
export const requestedExecutionSchema = z.object({
  providerId: z.string().trim().min(1).describe("The provider, as bb lists it: claude-code, codex, pi…"),
  model: z.string().trim().min(1).describe("A model of that provider, as its catalog in bb names it."),
  reasoningLevel: z.string().optional().describe("Left out: the model's default reasoning level."),
});
export type RequestedExecution = z.infer<typeof requestedExecutionSchema>;

/** A model in a provider's catalog, down to what the plugin reads (`providers.models`). */
export type CatalogModel = { model: string; isDefault: boolean; defaultReasoningEffort: string };

/**
 * What bb lists where the thread will run: its providers, and the requested provider's models
 * (none when it isn't listed, or bb can't load them there).
 */
export type ExecutionFacts = { providers: readonly { id: string; available: boolean }[]; models: readonly CatalogModel[] };

/**
 * The execution the manager asked for, or why bb can't run it there: the provider must be listed
 * and available, and the model in its catalog. A reasoning level it names is bb's to judge at the
 * spawn, as every spawn field is.
 */
export function executionOf(requested: RequestedExecution, { providers, models }: ExecutionFacts): Execution | { refused: string } {
  const { providerId } = requested;
  const runnable = providers.filter(({ available }) => available).map(({ id }) => id);
  if (!runnable.includes(providerId)) return { refused: `bb can't run ${providerId} there. It can run: ${runnable.join(", ")}.` };
  if (models.length === 0) return { refused: `bb can't load ${providerId}'s models there. It can run: ${runnable.join(", ")}.` };
  const model = models.find(({ model }) => model === requested.model);
  if (model === undefined) return { refused: `${providerId} has no model ${requested.model} there. Its models: ${models.map(modelText).join(", ")}. bb can run: ${runnable.join(", ")}.` };
  return { providerId, model: model.model, reasoningLevel: requested.reasoningLevel ?? model.defaultReasoningEffort };
}

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
