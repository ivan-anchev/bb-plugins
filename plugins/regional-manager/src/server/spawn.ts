// The one path that creates role threads: mint a ticket, spawn with it in the thread's metadata,
// then bind the thread id to it. Binding happens twice, on bb's spawn answer and on the thread's
// `thread.created` event, through the same idempotent bindTicket: whichever comes first binds, so
// a spawn answer that never arrives still leaves the thread its role.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Coordinator, CoordinatorStart } from "../contract.ts";
import type { Execution } from "../model/execution.ts";
import { PLACEHOLDER, PLACEHOLDER_MARK } from "./goal/goal.ts";
import { coordinatorIdSchema, ticketMetadataSchema, type Role } from "../model/role.ts";
import type { MemoryRoot } from "./memory/memory-files.ts";
import type { Store } from "./store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SpawnArgs = Parameters<Threads["spawn"]>[0];

// The parts of bb spawning uses, as narrow as the code reads them.
type SpawnBb = {
  pluginId: string;
  sdk: { threads: { spawn(args: SpawnArgs): Promise<{ id: string }>; getPluginMetadata: Threads["getPluginMetadata"] } };
  events: { on(event: "thread.created", handler: (payload: { thread: { id: string; originPluginId: string | null } }) => void | Promise<void>): void };
};

type SpawnStore = Pick<Store, "insertCoordinator" | "insertVerifierTicket" | "bindTicket">;

/** What a child thread is spawned with, beyond its ticket: its regional manager, its parent thread, its title, where it runs, what it runs on and its first message. */
type ChildRequest = {
  coordinator: Coordinator;
  parentThreadId: string;
  title: string;
  environment: NonNullable<SpawnArgs["environment"]>;
  execution: Execution;
  prompt: string;
};

/** What a verifier is spawned for: one check of an issue. */
export type VerifierRequest = ChildRequest & { role: Extract<Role, { kind: "verifier" }> };

// why auto: an agent works unattended, and a permission prompt on every edit would hold it until
// the user answers. The regional manager starts with auto for the same reason, and so does a
// verifier, which runs the agent's tests.
const CHILD_PERMISSION_MODE = "auto";

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

  /** A child of a thread of the regional manager's: the manager owns its lifecycle, and the plugin, not bb, reports on it. */
  function spawnChild(ticket: string, { coordinator, parentThreadId, title, environment, execution, prompt }: ChildRequest, settings: Pick<SpawnArgs, "visibility" | "serviceTier"> = {}): Promise<string> {
    return spawnWith(ticket, {
      projectId: coordinator.projectId,
      title,
      parentThreadId,
      // why: archiving or deleting the regional manager takes its agents and verifiers with it.
      lifecycleOwnerThreadId: coordinator.threadId,
      // why off: bb's own report cuts an answer at 4,000 characters, and an agent must not be woken by
      // its verifier; the plugin owns wakes.
      parentNotifications: "off",
      ...settings,
      ...execution,
      permissionMode: CHILD_PERMISSION_MODE,
      environment,
      prompt,
    });
  }

  return {
    /**
     * Starts a coordinating thread as the New page picked it, titled with its profile's name, its
     * first message the placeholder the goal hook holds until the user types the goal (goal.ts).
     * Its row, ticket and seeded memory exist before the spawn, so its first session and first tool
     * call find them. why no executionInputSources: bb then counts every execution field as chosen,
     * so it runs exactly what the page showed.
     */
    async coordinator({ request, verify, profile: { name, ...kept } }: CoordinatorStart): Promise<{ threadId: string }> {
      const id = coordinatorIdSchema.parse(randomUUID());
      const ticket = randomUUID();
      store.insertCoordinator({ id, ticket, projectId: request.projectId, verify, ...kept, createdAt: Date.now() });
      memory.of(id).seed();
      return {
        threadId: await spawnWith(ticket, {
          ...request,
          title: name,
          input: [{ type: "text", text: PLACEHOLDER, mentions: [] }],
          // why: the hook knows the spawn's own attempt by it, before bb answers the spawn with the thread.
          pluginSubmission: { pluginId: bb.pluginId, data: PLACEHOLDER_MARK },
        }),
      };
    },

    /**
     * Spawns an agent's thread under the ticket it was inserted with, as a child of its regional
     * manager, on the execution resolved for it, and on `serviceTier` when it inherits its manager's
     * (null: bb's default). Returns its thread; rejects as bb's spawn does.
     */
    agent(ticket: string, { serviceTier, ...request }: Omit<ChildRequest, "parentThreadId"> & { serviceTier: SpawnArgs["serviceTier"] | null }): Promise<string> {
      return spawnChild(ticket, { ...request, parentThreadId: request.coordinator.threadId }, serviceTier === null ? {} : { serviceTier });
    },

    /**
     * Spawns a hidden verifier for a check, as the request says: a handoff's, a child of the agent's
     * thread in the agent's environment, so it checks the very tree the agent committed in; a final
     * check's, a child of the regional manager's thread in a fresh worktree. Its check starts running
     * when its ticket binds. Returns its thread.
     */
    verifier({ role, ...request }: VerifierRequest): Promise<string> {
      const ticket = randomUUID();
      store.insertVerifierTicket(ticket, role, Date.now());
      // why hidden: the board links it; it would only crowd the sidebar.
      return spawnChild(ticket, request, { visibility: "hidden" });
    },
  };
}
