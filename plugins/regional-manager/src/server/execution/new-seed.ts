// What the New page starts from: the machine running bb, and what a regional manager runs on until
// the user picks otherwise, the provider bb defaults to (else the first it can run) on that
// provider's default model and reasoning level there.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewSeed } from "../../contract.ts";
import { modelsOf, type CatalogBb } from "./catalog.ts";

type Config = Awaited<ReturnType<BbPluginApi["sdk"]["system"]["config"]>>;

/** The parts of bb the seed reads, down to the fields it reads. */
type SeedBb = CatalogBb & { sdk: { system: { config(): Promise<{ primaryHostId: Config["primaryHostId"]; generalSettings: Pick<Config["generalSettings"], "defaultProviderId"> }> } } };

export async function newSeed(bb: SeedBb): Promise<NewSeed> {
  const { primaryHostId: hostId, generalSettings } = await bb.sdk.system.config();
  const routing = hostId === null ? {} : { hostId };
  const providers = (await bb.sdk.providers.list(routing)).filter(({ available }) => available);
  const provider = providers.find(({ id }) => id === generalSettings.defaultProviderId) ?? providers[0];
  if (provider === undefined) return { hostId, execution: null };
  const models = await modelsOf(bb, routing, provider.id);
  const model = models.find(({ isDefault }) => isDefault) ?? models[0];
  return { hostId, execution: model === undefined ? null : { providerId: provider.id, model: model.model, reasoningLevel: model.defaultReasoningEffort } };
}
