// What a verifier runs on. Independence is the point: a different model than the crew's when bb
// has one, and the crew's own only as a last resort, which its verdict then says.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { sameModel } from "../../model/execution.ts";
import type { VerifierExecution } from "../spawn.ts";

type Providers = BbPluginApi["sdk"]["providers"];
type Catalog = Awaited<ReturnType<Providers["models"]>>;

/** The parts of bb the choice reads, down to the fields it uses. */
export type ModelsBb = {
  log: Pick<PluginLogger, "warn">;
  sdk: {
    providers: {
      list(args: { environmentId: string }): Promise<Pick<Awaited<ReturnType<Providers["list"]>>[number], "id" | "available">[]>;
      models(args: { environmentId: string; providerId: string }): Promise<{ modelLoadError: Catalog["modelLoadError"]; models: Pick<Catalog["models"][number], "model" | "isDefault" | "defaultReasoningEffort">[] }>;
    };
  };
};

/**
 * In order: the coordinating thread's model if it isn't the crew's; else the default model of
 * another provider bb can run in the crew's environment; else another model of the crew's
 * provider; else the crew's own. `coordinator` is null when bb has no turn of it on record.
 */
export async function verifierExecution(bb: ModelsBb, { worker, coordinator, environmentId }: { worker: VerifierExecution; coordinator: VerifierExecution | null; environmentId: string }): Promise<VerifierExecution> {
  if (coordinator !== null && !sameModel(coordinator, worker)) return coordinator;
  for (const provider of await bb.sdk.providers.list({ environmentId })) {
    if (!provider.available || provider.id === worker.providerId) continue;
    const other = pick(await catalogOf(bb, environmentId, provider.id), () => true);
    if (other !== null) return { providerId: provider.id, model: other.model, reasoningLevel: other.defaultReasoningEffort };
  }
  const sibling = pick(await catalogOf(bb, environmentId, worker.providerId), (model) => model.model !== worker.model);
  return sibling === null ? worker : { providerId: worker.providerId, model: sibling.model, reasoningLevel: sibling.defaultReasoningEffort };
}

type Model = Awaited<ReturnType<ModelsBb["sdk"]["providers"]["models"]>>["models"][number];

/** The provider's models, or none when bb can't load them: that provider is then passed over. */
async function catalogOf(bb: ModelsBb, environmentId: string, providerId: string): Promise<Model[]> {
  try {
    const catalog = await bb.sdk.providers.models({ environmentId, providerId });
    if (catalog.modelLoadError === null) return catalog.models;
    bb.log.warn(`A verifier can't run on ${providerId}: bb can't load its models (${catalog.modelLoadError.code}).`);
  } catch (error) {
    bb.log.warn(`A verifier can't run on ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return [];
}

/** The provider's default model if it qualifies, else its first that does. */
const pick = (models: readonly Model[], qualifies: (model: Model) => boolean): Model | null =>
  models.find((model) => model.isDefault && qualifies(model)) ?? models.find(qualifies) ?? null;
