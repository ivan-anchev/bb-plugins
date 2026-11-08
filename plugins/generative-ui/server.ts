import type {
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgents,
} from "@get-bb/plugin-sdk";
import { SKILL_NAME, UI_BLOCK_INSTRUCTIONS } from "./src/agent/instructions.ts";

interface GenerativeUiHost {
  agents: Pick<PluginAgents, "configure">;
}

export default function plugin(bb: GenerativeUiHost) {
  bb.agents.configure(configureThread);
}

function configureThread(context: PluginAgentConfigurationContext): PluginAgentConfiguration {
  return repliesReachPerson(context)
    ? { tools: [], skills: [SKILL_NAME], instructions: UI_BLOCK_INSTRUCTIONS }
    : { tools: [], skills: [] };
}

// Subagents and plugin-run threads report to another agent, which can't see UI.
function repliesReachPerson({ thread, origin }: PluginAgentConfigurationContext): boolean {
  const isTopLevel = thread.parentThreadId === null;
  const isUserFacingOrigin = origin.pluginId === null || origin.pluginId === "side-chat";
  return isTopLevel && isUserFacingOrigin;
}
