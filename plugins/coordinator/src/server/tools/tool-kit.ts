// What every tool module shares: the part of bb that registers a tool, and the shape of a refusal.
import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import type { z } from "zod";

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
