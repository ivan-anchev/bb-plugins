// The boat mark: the plugin's environment-provider icon (boat.svg) as bb lists it, for the sidebar badge and the homepage card.
import type { PluginEnvironmentProvider } from "@get-bb/plugin-sdk";
import { experimental_ProviderIcon as ProviderIcon, useEnvironmentProviders } from "@get-bb/plugin-sdk/app";
import { PROVIDER_ID } from "../contract.ts";

/** null until bb lists the provider. */
export function useBoatProvider(): PluginEnvironmentProvider | null {
  const { providers } = useEnvironmentProviders();
  return providers.find((provider) => provider.id === PROVIDER_ID) ?? null;
}

/** bb's fallback glyph until the provider is listed. */
export function BoatMark({ className }: { className: string }) {
  const provider = useBoatProvider();
  return <ProviderIcon providerKind="environment" provider={provider ?? { id: PROVIDER_ID }} className={className} aria-hidden />;
}
