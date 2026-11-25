// What every tool module shares: the part of bb that registers a tool, the shape of a refusal, and
// the refusal of numbered entries that don't take each numbered thing once.
import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { Agent } from "../../model/agent/agent.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import type { Busy } from "../issues/issue-turns.ts";
import type { Store } from "../store/store.ts";

/** The part of bb the tools use: registering a tool whose parameters are a zod schema. */
export type ToolsBb = {
  agents: {
    registerTool<Schema extends z.ZodType>(
      tool: PluginAgentToolRegistrationBase & {
        parameters: Schema;
        execute(params: z.output<Schema>, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
      },
    ): void;
  };
};

/** A result the agent reads as a failure: nothing was done, and the text says why. */
export const failed = (text: string): PluginAgentToolResult => ({ content: [{ type: "text", text }], isError: true });

/** The tool's refusal when its issue's turn stayed taken (issue-turns.ts): nothing was done, and the call can be made again. */
export const refusedBusy = (tool: string, { busy }: Busy): PluginAgentToolResult => failed(`${tool} is refused: ${busy}. Call ${tool} again in a minute.`);

/**
 * Runs the tool only for a regional manager, by the role the plugin's database holds for the
 * calling thread, never its metadata; any other caller is refused.
 */
export function forManager<Input>(
  store: { roleOfThread(threadId: string): Role | null },
  tool: string,
  run: (id: CoordinatorId, input: Input, ctx: PluginAgentToolContext) => PluginAgentToolResult | Promise<PluginAgentToolResult>,
): (input: Input, ctx: PluginAgentToolContext) => PluginAgentToolResult | Promise<PluginAgentToolResult> {
  return (input, ctx) => {
    const role = store.roleOfThread(ctx.threadId);
    if (role?.kind !== "coordinator") return failed(`${tool} is refused: only a regional manager can use it, and this thread was not started as one. Carry on without it.`);
    return run(role.coordinatorId, input, ctx);
  };
}

/** An agent thread's agent as stored now. why throw: an agent's role is inserted with its agent, in one transaction. */
export function agentOf(store: Pick<Store, "agent">, role: Extract<Role, { kind: "agent" }>): Agent {
  const agent = store.agent(role.coordinatorId, role.agentId);
  if (agent === null) throw new Error(`The agent ${role.agentId} of ${role.coordinatorId} is missing.`);
  return agent;
}

/** Why the numbers given don't take each of `count` things once, in words (`words`); null when they do. */
export function numbersRefusal(numbers: readonly number[], count: number, words: { verb: string; each: string; all: string }): string | null {
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((number) => !numbers.includes(number));
  const unknown = numbers.filter((number) => number > count);
  const repeated = numbers.filter((number, i) => numbers.indexOf(number) !== i);
  if (missing.length > 0) return `${words.verb} every ${words.each}; missing ${missing.join(", ")} of 1 to ${count}.`;
  if (unknown.length > 0) {
    if (count === 0) return `there are no ${words.all} to ${words.verb}; pass [].`;
    return `${count === 1 ? `there is only 1 ${words.each}` : `there are only ${count} ${words.all}`}; ${unknown.join(", ")} is not one.`;
  }
  if (repeated.length > 0) return `${words.verb} each ${words.each} once; ${repeated.join(", ")} appears more than once.`;
  return null;
}
