// The one path that creates role threads: mint a ticket, spawn with it in the thread's metadata,
// then bind the thread id to it. Binding happens twice, on bb's spawn answer and on the thread's
// `thread.created` event, through the same idempotent bindTicket: whichever comes first binds, so
// a spawn answer that never arrives still leaves the thread its role.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { coordinatorIdSchema, ticketMetadataSchema } from "../model/role.ts";
import type { MemoryRoot } from "./memory/memory-files.ts";
import type { Store } from "./store.ts";

type Threads = BbPluginApi["sdk"]["threads"];

// The parts of bb spawning uses, as narrow as the code reads them.
type SpawnBb = {
  pluginId: string;
  sdk: {
    threads: {
      spawn(args: Parameters<Threads["spawn"]>[0]): Promise<{ id: string }>;
      getPluginMetadata: Threads["getPluginMetadata"];
    };
  };
  events: { on(event: "thread.created", handler: (payload: { thread: { id: string; originPluginId: string | null } }) => Promise<void>): void };
};

type SpawnStore = Pick<Store, "insertCoordinator" | "bindTicket">;

export function createSpawner(bb: SpawnBb, store: SpawnStore, memory: MemoryRoot, onBound: () => void) {
  function bind(ticket: string, threadId: string): void {
    if (store.bindTicket(ticket, threadId)) onBound();
  }

  // why the handler reads the metadata itself: the event's thread carries no metadata. A thread
  // another plugin or a client made can't hold one of this plugin's tickets, so it is skipped
  // before the read.
  bb.events.on("thread.created", async ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId) return;
    const metadata = ticketMetadataSchema.safeParse(await bb.sdk.threads.getPluginMetadata({ threadId: thread.id }));
    if (metadata.success) bind(metadata.data.ticket, thread.id);
  });

  return {
    /**
     * Starts a coordinating thread from bb's composer, its request forwarded unchanged. Its row,
     * ticket and seeded memory exist before the spawn, so its first session and first tool call
     * find them.
     */
    async coordinator(request: NewThreadRequest): Promise<{ threadId: string }> {
      const id = coordinatorIdSchema.parse(randomUUID());
      const ticket = randomUUID();
      store.insertCoordinator({ id, ticket, projectId: request.projectId, createdAt: Date.now() });
      memory.of(id).seed(goalOf(request));
      const thread = await bb.sdk.threads.spawn({ ...request, pluginMetadata: { ticket } });
      bind(ticket, thread.id);
      return { threadId: thread.id };
    },
  };
}

/** The text the user typed; attachments stay in the thread's first message. */
const goalOf = (request: NewThreadRequest): string =>
  request.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
