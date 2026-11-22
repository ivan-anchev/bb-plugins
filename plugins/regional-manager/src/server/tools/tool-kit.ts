import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { CoordinatorId, Role } from "../../model/role.ts";
import type { Busy } from "../issues/issue-turns.ts";

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
  run: (id: CoordinatorId, input: Input) => PluginAgentToolResult | Promise<PluginAgentToolResult>,
): (input: Input, ctx: PluginAgentToolContext) => PluginAgentToolResult | Promise<PluginAgentToolResult> {
  return (input, { threadId }) => {
    const role = store.roleOfThread(threadId);
    if (role?.kind !== "coordinator") return failed(`${tool} is refused: only a regional manager can use it, and this thread was not started as one. Carry on without it.`);
    return run(role.coordinatorId, input);
  };
}
