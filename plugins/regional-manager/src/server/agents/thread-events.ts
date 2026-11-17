// bb's lifecycle events about the plugin's threads. Most are hints, not state: an agent thread's
// event only says that what its regional manager's views are derived from changed, so they are read
// again (the board, what was unblocked), and those derive everything on each read, so a missed event
// (a reload, a reconnect) costs nothing. An archived or deleted agent thread ends its agent, and a
// deleted regional manager is removed; the tick's reconcile catches any of those missed.
import type { PluginLogger, PluginThreadEventName } from "@get-bb/plugin-sdk";
import type { HolderThread } from "../../model/issue/status.ts";
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
] as const satisfies readonly PluginThreadEventName[];

/**
 * bb's event carrying the thread as it is now, at most once a second per thread while it works.
 * why: an approval or a question answered moves an issue out of Needs you without any status
 * change, and bb announces nothing else for it; and a thread moves to `starting` (In progress,
 * status.ts) before bb announces `thread.active`, and this is the first that says so.
 */
const THREAD_NOW_EVENT = "experimental_thread.events";

type ThreadEvent = { thread: { id: string; originPluginId: string | null } };

/** THREAD_NOW_EVENT, with the field read of the thread as it is now. */
type ThreadNowEvent = { thread: ThreadEvent["thread"] & Pick<HolderThread, "status"> };

type EventsBb = {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  events: {
    on(event: (typeof AGENT_THREAD_EVENTS)[number], handler: (payload: ThreadEvent) => void | Promise<void>): void;
    on(event: typeof THREAD_NOW_EVENT, handler: (payload: ThreadNowEvent) => void): void;
  };
};

type Deps = {
  store: Pick<Store, "roleOfThread" | "agent">;
  agents: Pick<Agents, "archived" | "deleted" | "remove">;
  /** Runs after something the regional manager's views are derived from changed. */
  onChange(id: CoordinatorId): void;
  /** Reads the regional manager's board again. */
  refreshBoard(id: CoordinatorId): void;
};

/**
 * Forwards the events, and returns what forgets a removed regional manager's agent threads. why
 * forget: the status last seen of each is kept until its thread moves, which an idle thread of a
 * removed manager never does.
 */
export function forwardThreadEvents(bb: EventsBb, { store, agents, onChange, refreshBoard }: Deps): { forget(id: CoordinatorId): void } {
  /** The role of a thread this plugin made; null for any other. why the origin first: a cheap filter before touching SQLite. */
  const roleOf = ({ thread }: ThreadEvent) => (thread.originPluginId === bb.pluginId ? store.roleOfThread(thread.id) : null);

  /** Runs `then` with the regional manager of an agent thread; nothing for any other thread. */
  const ofAgent =
    <P extends ThreadEvent>(then: (id: CoordinatorId, payload: P) => void) =>
    (payload: P) => {
      const role = roleOf(payload);
      if (role?.kind === "agent") then(role.coordinatorId, payload);
    };
  /** Of each regional manager's agent threads, the status each had in its last THREAD_NOW_EVENT since its last lifecycle event. */
  const statusSeen = new Map<CoordinatorId, Map<string, HolderThread["status"]>>();
  for (const event of AGENT_THREAD_EVENTS) {
    bb.events.on(
      event,
      ofAgent((id, payload) => {
        // why forget it: the thread moved since, so its next status is news even when it reads as the one seen, as a new turn's `starting` after the last turn's.
        statusSeen.get(id)?.delete(payload.thread.id);
        onChange(id);
      }),
    );
  }

  // why a status only once: the event repeats every second while the thread works, and a repeat
  // changes Needs you at most, so it refreshes the board alone instead of reading every issue again.
  bb.events.on(
    THREAD_NOW_EVENT,
    ofAgent((id, { thread }: ThreadNowEvent) => {
      const seen = statusSeen.get(id) ?? new Map<string, HolderThread["status"]>();
      if (seen.get(thread.id) === thread.status) return refreshBoard(id);
      statusSeen.set(id, seen.set(thread.id, thread.status));
      onChange(id);
    }),
  );

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

  return { forget: (id) => void statusSeen.delete(id) };
}
