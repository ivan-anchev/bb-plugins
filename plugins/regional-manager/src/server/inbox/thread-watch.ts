// bb's thread events about agents, turned into inbox events. They stand in for the report to the
// parent that agents spawn without: a turn that ended with no handoff, a failure, a question for
// the user. Each handler skips threads another plugin made before it touches SQLite.
import type { PluginLogger } from "@get-bb/plugin-sdk";
import type { Agent } from "../../model/agent.ts";
import { questionOf, type InteractionPayload } from "../../model/interaction.ts";
import { ifCurrent, type TurnsBb } from "../agents/threads.ts";
import type { Store } from "../store/store.ts";
import type { Inbox } from "./inbox.ts";

type ThreadRef = { id: string; originPluginId: string | null };
type Interaction = { payload: InteractionPayload };

/** The parts of bb the watch uses, down to the fields it reads. */
type WatchBb = TurnsBb & {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  events: {
    on(event: "thread.idle", handler: (payload: { thread: ThreadRef; lastAssistantText: string | null }) => void | Promise<void>): void;
    on(event: "thread.failed", handler: (payload: { thread: ThreadRef; error: string | null }) => void): void;
    on(event: "interaction.pending", handler: (payload: { thread: ThreadRef; interaction: Interaction }) => void): void;
  };
};

type Deps = { bb: WatchBb; store: Pick<Store, "roleOfThread" | "agent" | "latestHandoff">; inbox: Pick<Inbox, "record"> };

export function watchAgentThreads({ bb, store, inbox }: Deps): void {
  /** The agent whose thread this is while it holds its issue, or null for any other thread. */
  function holderOf(thread: ThreadRef): (Agent & { threadId: string }) | null {
    if (thread.originPluginId !== bb.pluginId) return null;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "agent") return null;
    const agent = store.agent(role.coordinatorId, role.agentId);
    return agent !== null && agent.ended === null && agent.threadId !== null ? { ...agent, threadId: agent.threadId } : null;
  }

  const on = (agent: Agent) => ({ issueId: agent.issueId, agentId: agent.id });

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const agent = holderOf(thread);
    if (agent === null) return;
    try {
      if ((await ifCurrent(bb, agent.threadId, store.latestHandoff(agent.coordinatorId, agent.id))) !== null) return;
    } catch (error) {
      // why not record: without the thread's turns the plugin can't tell an ended report from a missing one. The board still shows which.
      bb.log.warn(`Could not read the turns of ${agent.id} (${thread.id}), so its idle is not reported: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    inbox.record(agent.coordinatorId, { kind: "idle-without-handoff", ...on(agent), lastAnswer: lastAssistantText });
  });

  bb.events.on("thread.failed", ({ thread, error }) => {
    const agent = holderOf(thread);
    if (agent !== null) inbox.record(agent.coordinatorId, { kind: "failed", ...on(agent), error });
  });

  bb.events.on("interaction.pending", ({ thread, interaction }) => {
    const agent = holderOf(thread);
    // why tell the regional manager: only the user can answer an agent's question or approval, and it says so in its digest.
    if (agent !== null) inbox.record(agent.coordinatorId, { kind: "needs-input", ...on(agent), question: questionOf(interaction.payload) });
  });
}
