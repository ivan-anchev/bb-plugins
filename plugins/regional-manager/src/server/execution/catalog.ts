import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { executionOf, runnableText, type CatalogModel, type CatalogRouting, type Execution, type ExecutionFacts, type RequestedExecution } from "../../model/execution.ts";

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

/**
 * The execution requested, resolved where `routing` points, or why not and what bb can run there.
 * Two catalog reads when it runs; a refusal adds one models read per other available provider.
 */
export async function resolvedExecution(bb: CatalogBb, routing: CatalogRouting, requested: RequestedExecution): Promise<Execution | { refused: string }> {
  const facts = await executionFacts(bb, routing, requested.providerId);
  const resolved = executionOf(requested, facts);
  if (!("refused" in resolved)) return resolved;
  return { refused: `${resolved.refused} ${runnableText(await runnableThere(bb, routing, requested.providerId, facts))}` };
}

async function runnableThere(bb: CatalogBb, routing: CatalogRouting, requestedId: string, { providers, models }: ExecutionFacts): Promise<string[]> {
  const loaded = await Promise.all(
    providers.filter(({ available }) => available).map(async ({ id }) => ((id === requestedId ? models : await modelsOf(bb, routing, id)).length > 0 ? [id] : [])),
  );
  return loaded.flat();
}

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
