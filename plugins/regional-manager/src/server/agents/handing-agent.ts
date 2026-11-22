// The agent whose done handoff a check judges, with its thread: whose environment the check's
// reviewer and verifier take, and whose model they keep away from.
import type { Agent } from "../../model/agent/agent.ts";
import type { HandoffCheck } from "../../model/verdict/check.ts";
import type { Store } from "../store/store.ts";

/** why throw: a handoff's check is made of a bound agent's handoff, and agents are never deleted while their regional manager is kept. */
export function handingAgent(store: Pick<Store, "agent">, { coordinatorId, subject }: Pick<HandoffCheck, "coordinatorId" | "subject">): Agent & { threadId: string } {
  const agent = store.agent(coordinatorId, subject.agentId);
  if (agent === null || agent.threadId === null) throw new Error(`The agent ${subject.agentId} of ${coordinatorId} has no thread.`);
  return { ...agent, threadId: agent.threadId };
}
