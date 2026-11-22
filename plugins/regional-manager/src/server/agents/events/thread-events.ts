import type { PluginLogger, PluginThreadEventName } from "@get-bb/plugin-sdk";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { HolderThread } from "../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import type { Store } from "../../store/store.ts";
import type { Verify } from "../../verify/verify.ts";
import type { Agents } from "../agents.ts";

const AGENT_THREAD_EVENTS = [
  "thread.active",
  "thread.idle",
  "thread.failed",
  "thread.archived",
  "thread.unarchived",
  "thread.deleted",
  "interaction.pending",
] as const satisfies readonly PluginThreadEventName[];

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
  verify: Pick<Verify, "lookAgain">;
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
export function forwardThreadEvents(bb: EventsBb, { store, agents, verify, onChange, refreshBoard }: Deps): { forget(id: CoordinatorId): void } {
  const roleOf = ({ thread }: ThreadEvent) => (thread.originPluginId === bb.pluginId ? store.roleOfThread(thread.id) : null);

  const ofAgent =
    <P extends ThreadEvent>(then: (id: CoordinatorId, payload: P) => void) =>
    (payload: P) => {
      const role = roleOf(payload);
      if (role?.kind === "agent") then(role.coordinatorId, payload);
    };
  const statusSeen = new Map<CoordinatorId, Map<string, HolderThread["status"]>>();
  for (const event of AGENT_THREAD_EVENTS) {
    bb.events.on(
      event,
      ofAgent((id, payload) => {
        statusSeen.get(id)?.delete(payload.thread.id);
        onChange(id);
      }),
    );
  }

  bb.events.on(
    THREAD_NOW_EVENT,
    ofAgent((id, { thread }: ThreadNowEvent) => {
      const seen = statusSeen.get(id) ?? new Map<string, HolderThread["status"]>();
      if (seen.get(thread.id) === thread.status) return refreshBoard(id);
      statusSeen.set(id, seen.set(thread.id, thread.status));
      onChange(id);
    }),
  );

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

  function issueOf(payload: ThreadEvent): { coordinatorId: CoordinatorId; issueId: IssueId } | null {
    const role = roleOf(payload);
    switch (role?.kind) {
      case "agent": {
        const agent = store.agent(role.coordinatorId, role.agentId);
        return agent === null ? null : { coordinatorId: agent.coordinatorId, issueId: agent.issueId };
      }
      case "verifier":
        return { coordinatorId: role.coordinatorId, issueId: role.issueId };
      case "coordinator":
      case undefined:
        return null;
      default:
        return role satisfies never;
    }
  }

  for (const event of ["thread.idle", "thread.failed"] as const) {
    bb.events.on(event, (payload) => {
      const issue = issueOf(payload);
      if (issue !== null) void verify.lookAgain(issue.coordinatorId, issue.issueId).catch(warned(`look at the checks of ${issue.issueId} again`));
    });
  }

  bb.events.on("interaction.pending", (payload) => {
    const role = roleOf(payload);
    if (role?.kind !== "verifier") return;
    const { coordinatorId, issueId } = role;
    refreshBoard(coordinatorId);
    void verify
      .lookAgain(coordinatorId, issueId)
      .catch(warned(`decline what the verifier of ${issueId} asked`))
      .finally(() => refreshBoard(coordinatorId));
  });

  return { forget: (id) => void statusSeen.delete(id) };
}
