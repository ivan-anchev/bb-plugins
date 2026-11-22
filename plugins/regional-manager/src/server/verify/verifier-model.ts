import { executionOf, sameModel, type CatalogModel, type CatalogRouting, type Execution } from "../../model/execution.ts";
import { executionFacts, modelsOf, type CatalogBb } from "../execution/catalog.ts";

/** What the choice weighs: the verifier the issue named (null: none), the regional manager's execution (null: bb has no turn of it on record), and the executions of the agents whose work it checks. */
type VerifierChoice = { named: Execution | null; manager: Execution | null; theirs: readonly Execution[]; routing: CatalogRouting };

/**
 * In order: the verifier the issue named, when bb lists it where the check runs and it is not one
 * of theirs; the regional manager's unless it is one of theirs; the default model of another
 * provider bb can run there; another model of one of their providers; else the first of theirs.
 */
export async function verifierExecution(bb: CatalogBb, { named, manager, theirs, routing }: VerifierChoice): Promise<Execution> {
  const independent = (execution: Pick<Execution, "providerId" | "model">) => !theirs.some((their) => sameModel(their, execution));
  if (named !== null && independent(named)) {
    const resolved = executionOf(named, await executionFacts(bb, routing, named.providerId));
    if (!("refused" in resolved)) return resolved;
  }
  if (manager !== null && independent(manager)) return manager;
  const providersOfTheirs = new Set(theirs.map(({ providerId }) => providerId));
  for (const provider of await bb.sdk.providers.list(routing)) {
    if (!provider.available || providersOfTheirs.has(provider.id)) continue;
    const other = pick(await modelsOf(bb, routing, provider.id), () => true);
    if (other !== null) return { providerId: provider.id, model: other.model, reasoningLevel: other.defaultReasoningEffort };
  }
  for (const providerId of providersOfTheirs) {
    const sibling = pick(await modelsOf(bb, routing, providerId), ({ model }) => independent({ providerId, model }));
    if (sibling !== null) return { providerId, model: sibling.model, reasoningLevel: sibling.defaultReasoningEffort };
  }
  const [own] = theirs;
  if (own === undefined) throw new Error("A check judges nobody's work.");
  return own;
}

const pick = (models: readonly CatalogModel[], qualifies: (model: CatalogModel) => boolean): CatalogModel | null =>
  models.find((model) => model.isDefault && qualifies(model)) ?? models.find(qualifies) ?? null;
