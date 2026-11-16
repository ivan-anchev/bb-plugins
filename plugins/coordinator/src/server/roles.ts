// The one configure callback: the plugin's database, not the thread's metadata, decides what a
// session gets. Synchronous by contract; an indexed better-sqlite3 read is.
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgents } from "@get-bb/plugin-sdk";
import { ticketMetadataSchema, type Role } from "../model/role.ts";
import { DISPLAY_NAME } from "../name.ts";
import type { Store } from "./store.ts";
import { COORDINATOR_TOOLS } from "./tools/coordinator-tools.ts";

/**
 * The plugin's user guide. why every thread gets it: once a plugin configures, bb gives a thread
 * only the skills it selects, and any thread may be asked how this plugin works.
 */
const GUIDE_SKILL = "crew-board";

type RolesBb = { agents: Pick<PluginAgents, "configure"> };

export function registerRoles(bb: RolesBb, store: Pick<Store, "roleFor">): void {
  bb.agents.configure((ctx) => {
    const role = store.roleFor(ctx.thread.id, ticketOf(ctx));
    return role === null ? { tools: [], skills: [GUIDE_SKILL] } : configurationFor(role);
  });
}

// why the metadata is only a lookup key: anyone can write it, and roleFor matches a ticket only
// while it is unbound.
function ticketOf(ctx: PluginAgentConfigurationContext): string | null {
  const metadata = ticketMetadataSchema.safeParse(ctx.pluginMetadata);
  return metadata.success ? metadata.data.ticket : null;
}

function configurationFor(role: Role): PluginAgentConfiguration {
  switch (role.kind) {
    case "coordinator":
      return { tools: [...COORDINATOR_TOOLS], skills: [GUIDE_SKILL, "coordinating"], instructions: COORDINATOR_RULES };
  }
}

const COORDINATOR_RULES = `You are a ${DISPLAY_NAME}: a long-lived thread that coordinates a body of work for the user, who is your principal. The user's first message is your goal.
- Call crew_catch_up first, at the start of every turn. Your memory is its files, not this conversation: reread them rather than trusting what you remember.
- You plan, delegate, track and report. You never edit project files, run builds or commit yourself.
- You can't yet write memory or start crew threads: you have crew_catch_up and crew_memory_read only. Until you can, reply with your plan and with what you would delegate, each piece with done-criteria someone could check by running something.
- The coordinating skill is your playbook.`;
