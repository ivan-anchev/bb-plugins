// bb's lifecycle events about the plugin's threads. Most are hints, not state: an agent thread's
// event only tells its regional manager's board to read again, and the board derives everything on
// each read, so a missed event (a reload, a reconnect) costs nothing. An archived or deleted agent
// thread ends its agent, and a deleted regional manager is removed; the tick's reconcile catches any
// of those missed.
import type { PluginLogger, PluginThreadEventName } from "@get-bb/plugin-sdk";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store/store.ts";
import type { Agents } from "./agents.ts";

const AGENT_THREAD_EVENTS = [
  "thread.active",
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "interaction.pending",
  // why: an approval or a question answered moves an issue out of Needs you without any status
  // change, and bb announces nothing else for it. bb sends this at most once a second per thread.
  "experimental_thread.events",
] as const satisfies readonly PluginThreadEventName[];

type ThreadEvent = { thread: { id: string; originPluginId: string | null } };

type EventsBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  events: { on(event: (typeof AGENT_THREAD_EVENTS)[number], handler: (payload: ThreadEvent) => void | Promise<void>): void };
};

type Deps = { store: Pick<Store, "roleOfThread" | "agent">; agents: Pick<Agents, "archived" | "deleted" | "remove">; refreshBoard(id: CoordinatorId): void };

export function forwardThreadEvents(bb: EventsBb, { store, agents, refreshBoard }: Deps): void {
  /** The role of a thread this plugin made; null for any other. why the origin first: a cheap filter before touching SQLite. */
  const roleOf = ({ thread }: ThreadEvent) => (thread.originPluginId === bb.pluginId ? store.roleOfThread(thread.id) : null);

  for (const event of AGENT_THREAD_EVENTS) {
    bb.events.on(event, (payload) => {
      const role = roleOf(payload);
      if (role?.kind === "agent") refreshBoard(role.coordinatorId);
    });
  }

  /** The agent whose thread this is, while it holds its issue. */
  function holderOf(payload: ThreadEvent) {
    const role = roleOf(payload);
    if (role?.kind !== "agent") return null;
    const agent = store.agent(role.coordinatorId, role.agentId);
    return agent?.ended === null ? agent : null;
  }

  const warned = (what: string) => (error: unknown) => bb.log.warn(`Could not ${what}; the next tick tries again: ${error instanceof Error ? error.message : String(error)}`);

  bb.events.on("thread.archived", async (payload) => {
    const agent = holderOf(payload);
    if (agent !== null) await agents.archived(agent).catch(warned(`end ${agent.id}, whose thread was archived`));
  });

  bb.events.on("thread.deleted", async (payload) => {
    const role = roleOf(payload);
    if (role?.kind === "coordinator") return agents.remove(role.coordinatorId);
    const agent = holderOf(payload);
    if (agent !== null) await agents.deleted(agent).catch(warned(`end ${agent.id}, whose thread was deleted`));
  });
}
