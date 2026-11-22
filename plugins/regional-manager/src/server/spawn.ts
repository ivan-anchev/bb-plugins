import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { typedText, type ComposerRequest, type Coordinator } from "../contract.ts";
import type { Execution } from "../model/execution.ts";
import { issueKeyOf } from "../model/issue/key/issue-key.ts";
import { ticketMetadataSchema, type CoordinatorId, type Role } from "../model/role.ts";
import type { MemoryRoot } from "./memory/memory-files.ts";
import type { Store } from "./store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SpawnArgs = Parameters<Threads["spawn"]>[0];

type SpawnBb = {
  pluginId: string;
  sdk: {
    threads: {
      spawn(args: SpawnArgs): Promise<{ id: string }>;
      getPluginMetadata: Threads["getPluginMetadata"];
      list(args: { originPluginId: string; hasParent: false; archived: false; includeHidden: true }): Promise<readonly { id: string }[]>;
    };
    projects: { get(args: { projectId: string }): Promise<{ name: string }> };
  };
  events: { on(event: "thread.created", handler: (payload: { thread: { id: string; originPluginId: string | null } }) => void | Promise<void>): void };
};

type SpawnStore = Pick<Store, "startsOn" | "insertVerifierTicket" | "bindTicket" | "roleOfThread">;

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

const CHILD_PERMISSION_MODE = "auto";

export type Spawner = ReturnType<typeof createSpawner>;

export function createSpawner(bb: SpawnBb, store: SpawnStore, memory: MemoryRoot, onBound: (role: Role) => void) {
  function bind(ticket: string, threadId: string): void {
    const role = store.bindTicket(ticket, threadId);
    if (role !== null) onBound(role);
  }

  bb.events.on("thread.created", async ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId) return;
    const ticket = ticketIn(await bb.sdk.threads.getPluginMetadata({ threadId: thread.id }));
    if (ticket !== null) bind(ticket, thread.id);
  });

  async function unboundManagerThread(ticket: string): Promise<string | null> {
    for (const { id } of await bb.sdk.threads.list({ originPluginId: bb.pluginId, hasParent: false, archived: false, includeHidden: true })) {
      if (store.roleOfThread(id) === null && ticketIn(await bb.sdk.threads.getPluginMetadata({ threadId: id })) === ticket) return id;
    }
    return null;
  }

  async function spawnWith(ticket: string, args: SpawnArgs): Promise<string> {
    const thread = await bb.sdk.threads.spawn({ ...args, pluginMetadata: { ticket } });
    bind(ticket, thread.id);
    return thread.id;
  }

  function spawnChild(ticket: string, { coordinator, parentThreadId, title, environment, execution, prompt }: ChildRequest, settings: Pick<SpawnArgs, "visibility" | "serviceTier"> = {}): Promise<string> {
    return spawnWith(ticket, {
      projectId: coordinator.projectId,
      title,
      parentThreadId,
      lifecycleOwnerThreadId: coordinator.threadId,
      parentNotifications: "off",
      ...settings,
      ...execution,
      permissionMode: CHILD_PERMISSION_MODE,
      environment,
      prompt,
    });
  }

  return {
    async coordinator(id: CoordinatorId, { ticket, name }: { ticket: string; name: string }, request: ComposerRequest): Promise<string> {
      const earlier = await unboundManagerThread(ticket);
      if (earlier !== null) {
        bind(ticket, earlier);
        return earlier;
      }
      const project = await bb.sdk.projects.get({ projectId: request.projectId });
      store.startsOn(id, request.projectId, issueKeyOf(project.name));
      memory.of(id).seed(typedText(request));
      return spawnWith(ticket, { ...request, title: name });
    },

    agent(ticket: string, { serviceTier, ...request }: Omit<ChildRequest, "parentThreadId"> & { serviceTier: SpawnArgs["serviceTier"] | null }): Promise<string> {
      return spawnChild(ticket, { ...request, parentThreadId: request.coordinator.threadId }, serviceTier === null ? {} : { serviceTier });
    },

    verifier({ role, ...request }: VerifierRequest): Promise<string> {
      const ticket = randomUUID();
      store.insertVerifierTicket(ticket, role, Date.now());
      return spawnChild(ticket, request, { visibility: "hidden" });
    },
  };
}

function ticketIn(metadata: unknown): string | null {
  const parsed = ticketMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data.ticket : null;
}
