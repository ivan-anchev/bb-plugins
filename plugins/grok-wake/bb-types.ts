import type {
  BbPluginApi,
  PluginSettingsHandle,
  PluginThreadEventHandler,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import type { routesSetting } from "./routes.ts";

/** bb's thread row as thread events carry it; the SDK does not export the name. */
export type ThreadResponse = PluginThreadEventPayloads["thread.idle"]["thread"];

/** An open question, approval, or plugin prompt; the SDK does not export the name. */
export type PendingInteraction = PluginThreadEventPayloads["interaction.pending"]["interaction"];

export type RoutesDescriptors = typeof routesSetting;

/** A target's URL or key field: a native secret string with no default. */
export interface SecretDescriptor {
  type: "string";
  secret: true;
  label: string;
  description: string;
}

/** A target's two secret fields, keyed by their `GROK_WAKE_<TARGET>_*` names. */
export type SecretPairDescriptors = Record<string, SecretDescriptor>;

/** The two kinds of settings grok-wake declares; bb's generic `define` serves both. */
export interface GrokWakeSettings {
  define(descriptors: RoutesDescriptors): PluginSettingsHandle<RoutesDescriptors>;
  define(descriptors: SecretPairDescriptors): PluginSettingsHandle<SecretPairDescriptors>;
}

/** The thread events that wake a bot; grok-wake listens to no others. */
export type AttentionEvent = "interaction.pending" | "thread.idle" | "thread.failed";

export interface GrokWakeEvents {
  on(event: "interaction.pending", handler: PluginThreadEventHandler<"interaction.pending">): void;
  on(event: "thread.idle", handler: PluginThreadEventHandler<"thread.idle">): void;
  on(event: "thread.failed", handler: PluginThreadEventHandler<"thread.failed">): void;
}

/** The slice of the plugin API grok-wake uses, so tests can hand it a small fake. */
export interface GrokWakeHost extends Pick<BbPluginApi, "pluginId" | "log" | "cli" | "onDispose"> {
  settings: GrokWakeSettings;
  events: GrokWakeEvents;
  storage: Pick<BbPluginApi["storage"], "database" | "migrate">;
  sdk: {
    threads: {
      interactions: Pick<BbPluginApi["sdk"]["threads"]["interactions"], "list">;
      events: Pick<BbPluginApi["sdk"]["threads"]["events"], "list">;
    };
    plugins: Pick<BbPluginApi["sdk"]["plugins"], "reload">;
  };
}
