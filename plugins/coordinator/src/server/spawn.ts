// The one path that creates role threads: mint a ticket, spawn with it in the thread's metadata,
// then bind the thread id to it. Binding happens twice, on bb's spawn answer and on the thread's
// `thread.created` event, through the same idempotent bindTicket: whichever comes first binds, so
// a spawn answer that never arrives still leaves the thread its role.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import type { Coordinator } from "../contract.ts";
import type { Placement } from "../model/crew.ts";
import { memoryFileSchema } from "../model/memory-file.ts";
import { coordinatorIdSchema, ticketMetadataSchema, type CrewId, type Role } from "../model/role.ts";
import { crewBrief } from "./crew/brief.ts";
import type { MemoryRoot } from "./memory/memory-files.ts";
import type { Store } from "./store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SpawnArgs = Parameters<Threads["spawn"]>[0];

// The parts of bb spawning uses, as narrow as the code reads them.
type SpawnBb = {
  pluginId: string;
  sdk: {
    threads: {
      spawn(args: SpawnArgs): Promise<{ id: string }>;
      getPluginMetadata: Threads["getPluginMetadata"];
      list(args: { threadIds: string[]; includeHidden: true }): Promise<{ id: string; environmentHostId: string | null }[]>;
    };
  };
  events: { on(event: "thread.created", handler: (payload: { thread: { id: string; originPluginId: string | null } }) => void | Promise<void>): void };
};

type SpawnStore = Pick<Store, "insertCoordinator" | "insertCrew" | "bindTicket" | "crew">;

/** What crew_start asks for. */
export type CrewRequest = { title: string; brief: string; doneCriteria: string[]; placement: Placement };

/** A started crew, or one saved whose thread bb never confirmed: it stays on the board, not started. */
export type CrewLaunch = { crewId: CrewId } & ({ kind: "started"; threadId: string } | { kind: "failed"; error: string });

// why auto: a crew works unattended, and a permission prompt on every edit would hold it until the
// user answers. The Coordinator starts with auto for the same reason.
const CREW_PERMISSION_MODE = "auto";

const CREW_RULES = memoryFileSchema.parse("CREW.md");
const MEMORY_INDEX = memoryFileSchema.parse("MEMORY.md");

export type Spawner = ReturnType<typeof createSpawner>;

export function createSpawner(bb: SpawnBb, store: SpawnStore, memory: MemoryRoot, onBound: (role: Role) => void) {
  function bind(ticket: string, threadId: string): void {
    const role = store.bindTicket(ticket, threadId);
    if (role !== null) onBound(role);
  }

  // why the handler reads the metadata itself: the event's thread carries no metadata. A thread
  // another plugin or a client made can't hold one of this plugin's tickets, so it is skipped
  // before the read.
  bb.events.on("thread.created", async ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId) return;
    const metadata = ticketMetadataSchema.safeParse(await bb.sdk.threads.getPluginMetadata({ threadId: thread.id }));
    if (metadata.success) bind(metadata.data.ticket, thread.id);
  });

  async function spawnWith(ticket: string, args: SpawnArgs): Promise<string> {
    const thread = await bb.sdk.threads.spawn({ ...args, pluginMetadata: { ticket } });
    bind(ticket, thread.id);
    return thread.id;
  }

  // A fresh worktree of the default branch on the coordinating thread's machine, as a child of a
  // live thread gets from bb; or the environment provider the Coordinator named.
  async function environmentFor(placement: Placement, coordinatorThreadId: string): Promise<SpawnArgs["environment"]> {
    switch (placement.kind) {
      case "worktree": {
        const [thread] = await bb.sdk.threads.list({ threadIds: [coordinatorThreadId], includeHidden: true });
        const hostId = thread?.environmentHostId ?? undefined;
        return { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } };
      }
      case "provider":
        return { type: "provider", environmentProviderId: placement.environmentProviderId, inputs: null };
    }
  }

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
      return { threadId: await spawnWith(ticket, request) };
    },

    /**
     * Starts a crew as a child of the coordinating thread. Its row is saved before the spawn, so a
     * spawn that fails still leaves it on the board rather than a thread nobody tracks.
     */
    async crew(coordinator: Coordinator, request: CrewRequest): Promise<CrewLaunch> {
      const ticket = randomUUID();
      const crewId = store.insertCrew({ coordinatorId: coordinator.id, ticket, ...request, createdAt: Date.now() });
      const files = memory.of(coordinator.id);
      try {
        const threadId = await spawnWith(ticket, {
          projectId: coordinator.projectId,
          title: request.title,
          parentThreadId: coordinator.threadId,
          // why: archiving or deleting the coordinating thread takes its crew with it.
          lifecycleOwnerThreadId: coordinator.threadId,
          // why off: bb's own report cuts a crew's answer at 4,000 characters; the plugin owns wakes.
          parentNotifications: "off",
          permissionMode: CREW_PERMISSION_MODE,
          environment: await environmentFor(request.placement, coordinator.threadId),
          prompt: crewBrief({ id: crewId, ...request }, { crewRules: files.read(CREW_RULES).text, index: files.read(MEMORY_INDEX).text }),
        });
        return { crewId, kind: "started", threadId };
      } catch (error) {
        // why read again: bb may have made the thread and bound it through thread.created, with only its answer lost.
        const launch = store.crew(coordinator.id, crewId)?.launch;
        if (launch?.kind === "started") return { crewId, kind: "started", threadId: launch.threadId };
        return { crewId, kind: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** The text the user typed; attachments stay in the thread's first message. */
const goalOf = (request: NewThreadRequest): string =>
  request.input.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
