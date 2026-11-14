import type {
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgents,
} from "@get-bb/plugin-sdk";
import { FIGURES_INSTRUCTIONS } from "./instructions.ts";

interface FiguresHost {
  agents: Pick<PluginAgents, "configure">;
}

export default function plugin(bb: FiguresHost) {
  bb.agents.configure(configureThread);
}

/** Figures render in chat, so only agents whose replies a person reads are told about them. */
function configureThread(context: PluginAgentConfigurationContext): PluginAgentConfiguration {
  return repliesReachPerson(context)
    ? { tools: [], skills: ["mdxcn"], instructions: FIGURES_INSTRUCTIONS }
    : { tools: [], skills: [] };
}

function repliesReachPerson({ thread, origin }: PluginAgentConfigurationContext): boolean {
  const isTopLevel = thread.parentThreadId === null;
  const isUserFacingOrigin = origin.pluginId === null || origin.pluginId === "side-chat";
  return isTopLevel && isUserFacingOrigin;
}
