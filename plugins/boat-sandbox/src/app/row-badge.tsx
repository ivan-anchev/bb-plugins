// The boat icon on the metadata line of a sidebar thread row whose thread runs on a boat sandbox.
import { useMemo } from "react";
import type { ExperimentalThreadRowMetadataDataInput, ExperimentalThreadRowMetadataProps, PluginEnvironmentProvider } from "@get-bb/plugin-sdk";
import { experimental_ProviderIcon as ProviderIcon, experimental_useRpcKeyedQuery, useEnvironmentProviders, useSettings } from "@get-bb/plugin-sdk/app";
import { boatSandboxContract as contract, PROVIDER_ID } from "../contract.ts";
import { boatRowIds } from "./row-marks.ts";

export interface BoatRows {
  /** The threads whose rows show the icon. */
  marked: ReadonlySet<string>;
  /** The plugin's environment provider, whose icon is the boat mark; null until bb lists it. */
  provider: PluginEnvironmentProvider | null;
}

const LABEL = "Runs on a boat sandbox";
const NONE: ReadonlySet<string> = new Set();

/** One batched read for every row's host, as bb asks of row metadata. Marks nothing while the Boat icon setting is off. */
export function useBoatRows({ threads }: ExperimentalThreadRowMetadataDataInput): BoatRows {
  const shown = useSettings().values?.sidebarIcon === true;
  const hostIds = useMemo(() => [...new Set(threads.flatMap((thread) => (thread.host === null ? [] : [thread.host.id])))], [threads]);
  const query = experimental_useRpcKeyedQuery({ contract, method: "boatHosts", keys: hostIds, enabled: shown && hostIds.length > 0 });
  const marked = useMemo(() => (shown && query.data !== undefined ? boatRowIds(threads, query.data) : NONE), [shown, threads, query.data]);
  const { providers } = useEnvironmentProviders();
  return { marked, provider: providers.find((provider) => provider.id === PROVIDER_ID) ?? null };
}

export function BoatRowBadge({ thread, data }: ExperimentalThreadRowMetadataProps<BoatRows>) {
  if (data.provider === null || !data.marked.has(thread.id)) return null;
  return (
    <span role="img" aria-label={LABEL} title={LABEL} className="flex shrink-0 items-center text-muted-foreground">
      <ProviderIcon providerKind="environment" provider={data.provider} className="size-3.5" aria-hidden />
    </span>
  );
}
