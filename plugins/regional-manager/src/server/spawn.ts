// The one path that creates role threads: mint a ticket, spawn with it in the thread's metadata,
// then bind the thread id to it. Binding happens twice, on bb's spawn answer and on the thread's
// `thread.created` event, through the same idempotent bindTicket: whichever comes first binds, so
// a spawn answer that never arrives still leaves the thread its role.
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { typedText, type Coordinator } from "../contract.ts";
import { environmentOf, type Crew } from "../model/crew.ts";
import type { Execution } from "../model/execution.ts";
import type { Handoff } from "../model/handoff.ts";
import { memoryFileSchema } from "../model/memory-file.ts";
import { coordinatorIdSchema, ticketMetadataSchema, type CrewId, type Role } from "../model/role.ts";
import type { Checkout } from "../model/verdict/checkout.ts";
import { crewBrief } from "./crew/brief.ts";
import { verifierBrief } from "./verify/verifier-brief.ts";
import type { MemoryRoot } from "./memory/memory-files.ts";
import type { Store } from "./store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SpawnArgs = Parameters<Threads["spawn"]>[0];
type ExecutionOptions = NonNullable<Awaited<ReturnType<Threads["defaultExecutionOptions"]>>>;

/** The coordinating thread as bb lists it: the provider it runs on, and its machine. */
type CoordinatorThread = { id: string; providerId: string; environmentHostId: string | null };

/** What a spawn runs on, every field chosen: see `picked`. */
type SpawnExecution = Pick<SpawnArgs, "providerId" | "model" | "reasoningLevel" | "permissionMode" | "serviceTier" | "sessionOptions">;

// The parts of bb spawning uses, as narrow as the code reads them.
type SpawnBb = {
  pluginId: string;
  sdk: {
    threads: {
      spawn(args: SpawnArgs): Promise<{ id: string }>;
      getPluginMetadata: Threads["getPluginMetadata"];
      list(args: { threadIds: string[]; includeHidden: true }): Promise<CoordinatorThread[]>;
      /** The model, reasoning level and service tier of the thread's latest turn; null before its first. */
      defaultExecutionOptions(args: { threadId: string }): Promise<Pick<ExecutionOptions, "model" | "reasoningLevel" | "serviceTier"> | null>;
    };
  };
  events: { on(event: "thread.created", handler: (payload: { thread: { id: string; originPluginId: string | null } }) => void | Promise<void>): void };
};

type SpawnStore = Pick<Store, "insertCoordinator" | "insertCrew" | "insertVerifierTicket" | "crewTicket" | "bindTicket" | "crew">;

/** What a crew is saved with: what crew_start asks for, or what a superseded crew had. */
export type CrewRequest = Pick<Crew, "title" | "brief" | "doneCriteria" | "placement">;

/** What a verifier runs on: chosen by the plugin, never left to bb's default. Named Execution everywhere in commit 2. */
export type VerifierExecution = Execution;

/** What a verifier checks: one done handoff of a started crew, in the crew's environment, whose checkout the plugin read as it handed off. */
export type VerifierRequest = {
  coordinator: Coordinator;
  crew: Crew & { launch: { kind: "started" } };
  handoff: Extract<Handoff, { status: "done" }>;
  checkout: Checkout;
  environmentId: string;
  execution: VerifierExecution;
};

/** A crew's spawn: its thread, or why bb didn't confirm one, which leaves the crew unstarted. */
export type CrewLaunch = { crewId: CrewId } & ({ kind: "started"; threadId: string } | { kind: "failed"; error: string });

// why auto: a crew works unattended, and a permission prompt on every edit would hold it until the
// user answers. The Coordinator starts with auto for the same reason, and so does a verifier, which
// runs the crew's tests.
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

  async function coordinatorThread(threadId: string): Promise<CoordinatorThread> {
    const [thread] = await bb.sdk.threads.list({ threadIds: [threadId], includeHidden: true });
    if (thread === undefined) throw new Error(`bb no longer has the regional manager ${threadId}.`);
    return thread;
  }

  /**
   * A crew runs on its coordinating thread's provider and model as they are now. why not leave it
   * to bb: bb gives a child its parent's only while that provider is available and the parent has a
   * turn on record, and its own default otherwise.
   */
  async function inheritedExecution(coordinator: CoordinatorThread): Promise<SpawnExecution> {
    const options = await bb.sdk.threads.defaultExecutionOptions({ threadId: coordinator.id });
    if (options === null) throw new Error("bb has no model on record for the regional manager, so the crew has none to inherit.");
    const { model, reasoningLevel, serviceTier } = options;
    return { providerId: coordinator.providerId, model, reasoningLevel, serviceTier, permissionMode: CREW_PERMISSION_MODE };
  }

  return {
    /**
     * Starts a coordinating thread from bb's composer, on the provider, model and modes it shows. Its row,
     * ticket and seeded memory exist before the spawn, so its first session and first tool call
     * find them.
     */
    async coordinator(request: NewThreadRequest, verify: boolean): Promise<{ threadId: string }> {
      const id = coordinatorIdSchema.parse(randomUUID());
      const ticket = randomUUID();
      store.insertCoordinator({ id, ticket, projectId: request.projectId, verify, createdAt: Date.now() });
      memory.of(id).seed(typedText(request));
      return { threadId: await spawnWith(ticket, picked(request)) };
    },

    /** Saves a crew: its row and its unbound ticket. Nothing runs until it is launched. */
    saveCrew(coordinator: Coordinator, request: CrewRequest): CrewId {
      return store.insertCrew({ coordinatorId: coordinator.id, ticket: randomUUID(), ...request, createdAt: Date.now() });
    },

    /**
     * Spawns a saved crew's thread from what is stored, as a child of the coordinating thread, on
     * the coordinating thread's provider and model. A spawn that fails leaves the crew unstarted.
     */
    async launch(coordinator: Coordinator, crew: Crew): Promise<CrewLaunch> {
      const files = memory.of(coordinator.id);
      try {
        const parent = await coordinatorThread(coordinator.threadId);
        const threadId = await spawnWith(store.crewTicket(coordinator.id, crew.id), {
          projectId: coordinator.projectId,
          title: crew.title,
          parentThreadId: coordinator.threadId,
          // why: archiving or deleting the coordinating thread takes its crew with it.
          lifecycleOwnerThreadId: coordinator.threadId,
          // why off: bb's own report cuts a crew's answer at 4,000 characters; the plugin owns wakes.
          parentNotifications: "off",
          ...(await inheritedExecution(parent)),
          // why its machine: a worktree crew gets its fresh worktree there, as a child of a live thread does from bb.
          environment: environmentOf(crew.placement, parent.environmentHostId),
          prompt: crewBrief(crew, { crewRules: files.read(CREW_RULES).text, index: files.read(MEMORY_INDEX).text }),
        });
        return { crewId: crew.id, kind: "started", threadId };
      } catch (error) {
        // why read again: bb may have made the thread and bound it through thread.created, with only its answer lost.
        const launch = store.crew(coordinator.id, crew.id)?.launch;
        if (launch?.kind === "started") return { crewId: crew.id, kind: "started", threadId: launch.threadId };
        return { crewId: crew.id, kind: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    },

    /**
     * Spawns a hidden verifier for a done handoff: a child of the crew's thread in the crew's own
     * environment, so it checks the very tree the crew committed in. Its verdict starts running
     * when its ticket binds. Returns its thread.
     */
    verifier({ coordinator, crew, handoff, checkout, environmentId, execution }: VerifierRequest): Promise<string> {
      const ticket = randomUUID();
      store.insertVerifierTicket(ticket, { kind: "verifier", coordinatorId: coordinator.id, crewId: crew.id, handoffId: handoff.id }, Date.now());
      return spawnWith(ticket, {
        projectId: coordinator.projectId,
        title: `Verify ${crew.id}: ${crew.title}`,
        parentThreadId: crew.launch.threadId,
        // why: archiving or deleting the coordinating thread takes its verifiers with it.
        lifecycleOwnerThreadId: coordinator.threadId,
        // why off: the plugin reads the verdict through crew_verdict, and the crew must not be woken by it.
        parentNotifications: "off",
        // why hidden: the board links it; it would only crowd the sidebar.
        visibility: "hidden",
        ...execution,
        permissionMode: CREW_PERMISSION_MODE,
        environment: { type: "reuse", environmentId },
        prompt: verifierBrief(crew, handoff, checkout),
      });
    },
  };
}

/**
 * The request with every execution field counted as chosen, so bb runs exactly what the user saw.
 * why without `executionInputSources`: bb counts every field of a spawn that has none. With one, bb
 * drops each field it leaves unmarked, and bb's composer leaves a field unmarked until the user
 * touches it; a dropped permission mode becomes the parent's.
 */
function picked<T extends { executionInputSources?: unknown }>({ executionInputSources: _, ...request }: T): Omit<T, "executionInputSources"> {
  return request;
}
