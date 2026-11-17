// What bb can run where a thread will run: its providers, and a provider's models, read by bb's own
// routing (an environment, a machine, or neither for bb's primary machine). One read per question,
// so a refusal and a verifier's choice see the same catalog.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { CatalogModel, CatalogRouting, ExecutionFacts } from "../../model/execution.ts";

type Providers = BbPluginApi["sdk"]["providers"];
type Catalog = Awaited<ReturnType<Providers["models"]>>;

/** The parts of bb a catalog read uses, down to the fields it reads. */
export type CatalogBb = {
  log: Pick<PluginLogger, "warn">;
  sdk: {
    providers: {
      list(args: CatalogRouting): Promise<Pick<Awaited<ReturnType<Providers["list"]>>[number], "id" | "available">[]>;
      models(args: CatalogRouting & { providerId: string }): Promise<{ modelLoadError: Catalog["modelLoadError"]; models: CatalogModel[] }>;
    };
  };
};

/** The providers bb lists where `routing` points, and `providerId`'s models there. */
export async function executionFacts(bb: CatalogBb, routing: CatalogRouting, providerId: string): Promise<ExecutionFacts> {
  const [providers, models] = await Promise.all([bb.sdk.providers.list(routing), modelsOf(bb, routing, providerId)]);
  return { providers, models };
}

/** The provider's models where `routing` points, or none when bb can't load them there: that provider is then passed over, with a warning. */
export async function modelsOf(bb: CatalogBb, routing: CatalogRouting, providerId: string): Promise<CatalogModel[]> {
  try {
    const catalog = await bb.sdk.providers.models({ ...routing, providerId });
    if (catalog.modelLoadError === null) return catalog.models;
    bb.log.warn(`bb can't load ${providerId}'s models there (${catalog.modelLoadError.code}), so nothing runs on it.`);
  } catch (error) {
    bb.log.warn(`bb can't load ${providerId}'s models there: ${error instanceof Error ? error.message : String(error)}`);
  }
  return [];
}
