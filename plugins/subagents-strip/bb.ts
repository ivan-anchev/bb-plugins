// bb's row and event types, and the SDK slice the thread source reads, named
// once. The SDK does not export them by name, so they are derived from the
// exported browser client and follow whatever SDK is installed.
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";

type Threads = PluginBrowserBbSdk["threads"];

/** One stored thread event. */
export type EventRow = Awaited<ReturnType<Threads["events"]["list"]>>[number];

// why: `timeline` is overloaded; ReturnType takes the last overload, the
// full | delta union, so pick the full response by its `rows`.
type TimelineFull = Extract<Awaited<ReturnType<Threads["timeline"]>>, { rows: unknown }>;

export type TimelineRow = TimelineFull["rows"][number];
type TimelinePage = TimelineFull["timelinePage"];
/**
 * Where the rows before a read begin: pass it back as beforeAnchorId and beforeAnchorSeq to read
 * the page before them. null: the read reached the thread's first row.
 */
export type OlderCursor = TimelinePage["olderCursor"];
/** A timeline read as the source keeps it: its rows, where older ones begin, and older rows that changed since. */
export type TimelineRead = Pick<TimelineFull, "rows"> & { timelinePage: Pick<TimelinePage, "olderCursor" | "olderRowUpdates"> };
/** Any row but a turn group: what a delegate's step is. */
export type StepRow = Exclude<TimelineRow, { kind: "turn" }>;
/** A step that did work: ran, read, edited, searched, asked, or delegated. */
export type WorkRow = Extract<StepRow, { kind: "work" }>;
/** What a command reads, lists, or searches, as bb reads it from the command line. */
export type ActivityIntent = Extract<WorkRow, { workKind: "command" }>["activityIntents"][number];
export type DelegationRow = Extract<TimelineRow, { kind: "work"; workKind: "delegation" }>;
/** A turn group: its status and completedAt settle a child thread. */
export type TurnRow = Extract<TimelineRow, { kind: "turn" }>;
export type AssistantRow = Extract<StepRow, { kind: "conversation"; role: "assistant" }>;
/** A message that starts a turn: the user's, another agent's, or bb's own system message. */
export type UserRow = Extract<StepRow, { kind: "conversation"; role: "user" }>;
// why: the operation row's operationKind is an enum, not a literal, so Extract alone cannot pick reasoning.
export type ReasoningRow = Extract<StepRow, { systemKind: "operation" }> & { operationKind: "reasoning" };
/** bb's "Stopped manually" row: what an interrupted turn leaves in place of a turn group. */
export type InterruptRow = Extract<StepRow, { systemKind: "operation" }> & { operationKind: "thread-interrupted" };

/** A background-task item as task events carry it. */
export type BackgroundTaskItem = Extract<EventRow, { type: "item/backgroundTask/completed" }>["data"]["item"];
export type TaskStatus = BackgroundTaskItem["taskStatus"];

type ThreadListRow = Awaited<ReturnType<Threads["list"]>>[number];

/**
 * A child thread as `threads.list({ parentThreadId })` returns it, narrowed to
 * what a child delegate is built from. `updatedAt` moves when its status does,
 * not on every event, so it versions the source's per-child cache.
 */
export type ChildThread = Pick<ThreadListRow, "id" | "providerId" | "title" | "titleFallback" | "status" | "createdAt" | "updatedAt">;

/**
 * The slice of the browser SDK a thread source uses: realtime plus four reads,
 * each narrowed to the fields the source keeps. The full SDK satisfies it.
 */
export type ThreadSdk = {
  subscribe: PluginBrowserBbSdk["subscribe"];
  threads: {
    get(args: Parameters<Threads["get"]>[0]): Promise<Pick<Awaited<ReturnType<Threads["get"]>>, "providerId">>;
    timeline(args: Parameters<Threads["timeline"]>[0] & { afterTag?: undefined }): Promise<TimelineRead>;
    events: { list(args: Parameters<Threads["events"]["list"]>[0]): Promise<EventRow[]> };
    /**
     * A thread's children. Hidden ones are left out unless asked for; archived ones are not, so the
     * source must ask (live: the route listed 10 children of a parent whose threads.count was 9).
     */
    list(args: NonNullable<Parameters<Threads["list"]>[0]> & { parentThreadId: string; archived: false }): Promise<ChildThread[]>;
  };
};

/** The `thread:changed` payload. */
export type ThreadChange = Parameters<
  Extract<Parameters<PluginBrowserBbSdk["subscribe"]>[0], { event: "thread:changed" }>["callback"]
>[0];
