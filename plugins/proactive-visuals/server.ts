import type {
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgents,
} from "@get-bb/plugin-sdk";
import { VISUALS_INSTRUCTIONS } from "./instructions.ts";

interface VisualsHost {
  agents: Pick<PluginAgents, "configure">;
}

export default function plugin(bb: VisualsHost) {
  bb.agents.configure(configureThread);
}

function configureThread(context: PluginAgentConfigurationContext): PluginAgentConfiguration {
  return repliesReachPerson(context)
    ? { tools: [], skills: [], instructions: VISUALS_INSTRUCTIONS }
    : { tools: [], skills: [] };
}

function repliesReachPerson({ thread, origin }: PluginAgentConfigurationContext): boolean {
  const isTopLevel = thread.parentThreadId === null;
  const isUserFacingOrigin = origin.pluginId === null || origin.pluginId === "side-chat";
  return isTopLevel && isUserFacingOrigin;
}
