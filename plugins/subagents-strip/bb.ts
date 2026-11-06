// bb's row and event types, and the SDK slice the thread source reads, named
// once. The SDK does not export them by name, so they are derived from the
// exported browser client and follow whatever SDK is installed.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

type Threads = PluginBrowserBbSdk["threads"];

/** One stored thread event. */
export type EventRow = Awaited<ReturnType<Threads["events"]["list"]>>[number];

// why: `timeline` is overloaded; ReturnType takes the last overload, the
// full | delta union, so pick the full response by its `rows`.
type TimelineRead = Awaited<ReturnType<Threads["timeline"]>>;
type TimelineFull = Extract<TimelineRead, { rows: unknown }>;

export type TimelineRow = TimelineFull["rows"][number];
/** Any row but a turn group: what a delegate's step is. */
export type StepRow = Exclude<TimelineRow, { kind: "turn" }>;
export type DelegationRow = Extract<TimelineRow, { kind: "work"; workKind: "delegation" }>;
// why: the operation row's operationKind is an enum, not a literal, so Extract alone cannot pick reasoning.
export type ReasoningRow = Extract<StepRow, { systemKind: "operation" }> & { operationKind: "reasoning" };

/** A background-task item as task events carry it. */
export type BackgroundTaskItem = Extract<EventRow, { type: "item/backgroundTask/completed" }>["data"]["item"];
export type TaskStatus = BackgroundTaskItem["taskStatus"];
export type TaskUsage = NonNullable<BackgroundTaskItem["usage"]>;

/**
 * The slice of the browser SDK a thread source uses: realtime plus three reads,
 * each narrowed to the fields the source keeps. The full SDK satisfies it.
 */
export type ThreadSdk = {
  subscribe: PluginBrowserBbSdk["subscribe"];
  threads: {
    get(args: Parameters<Threads["get"]>[0]): Promise<Pick<Awaited<ReturnType<Threads["get"]>>, "providerId">>;
    timeline(args: Parameters<Threads["timeline"]>[0] & { afterTag?: undefined }): Promise<Pick<TimelineFull, "rows">>;
    events: { list(args: Parameters<Threads["events"]["list"]>[0]): Promise<EventRow[]> };
  };
};

/** The `thread:changed` payload. */
export type ThreadChange = Parameters<
  Extract<Parameters<PluginBrowserBbSdk["subscribe"]>[0], { event: "thread:changed" }>["callback"]
>[0];
