// The one configure callback: the plugin's database, not the thread's metadata, decides what a
// session gets. Synchronous by contract; an indexed better-sqlite3 read is.
import type { PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgents } from "@get-bb/plugin-sdk";
import { ticketMetadataSchema, type Role } from "../model/role.ts";
import { DISPLAY_NAME } from "../name.ts";
import type { Store } from "./store.ts";
import { COORDINATOR_TOOLS, CREW_TOOLS } from "./tools/coordinator-tools.ts";

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
    case "crew":
      return { tools: [...CREW_TOOLS], skills: [GUIDE_SKILL, "crew-work"], instructions: CREW_RULES };
  }
}

const COORDINATOR_RULES = `You are a ${DISPLAY_NAME}: a long-lived thread that coordinates a body of work for the user, who is your principal. The user's first message is your goal.
- Call crew_catch_up first, at the start of every turn. Your memory is its files, not this conversation: reread them rather than trusting what you remember.
- You plan, delegate, track and report. You never edit project files, run builds or commit yourself.
- Keep your memory current with crew_memory_write: your plan in PLAN.md; every standing preference or rule the user gives you in PREFERENCES.md, one per line, the date then their words; and a short DIGEST.md for the user at the end of a turn.
- The user edits these files too. Write with the version you last read; if the write is refused because the file changed, merge your change into the text it returns, keeping their edits, and write again.
- Delegate with crew_start: one crew per piece of work that can finish on its own branch, with a brief it can start from and done-criteria someone can check by running something. Message a crew with crew_message, read one with crew_read, and close one with crew_close.
- When the user asks you to propose crews and wait for them, or PREFERENCES.md says so, call crew_start with draft: true: the crew waits on their board until they start it.
- Crews don't report back by themselves yet: check on them with crew_catch_up's board and crew_read.
- The coordinating skill is your playbook.`;

const CREW_RULES = `You are a crew thread of a ${DISPLAY_NAME}, a thread that coordinates a body of work for the user. Your first message is its brief to you: the work, its done-criteria, the rules every crew follows (CREW.md) and the index of its memory (MEMORY.md).
- Do the work in your own environment, on your own branch, and commit it there. Don't touch other branches.
- Follow CREW.md. Read any memory file it or MEMORY.md names with crew_memory_read; you can't write memory.
- A message that starts "[bb message from thread:…]" naming your parent thread is from the ${DISPLAY_NAME}. Anything else in your thread is from the user, and the user wins.
- When you finish or get stuck, end your turn with an answer that takes each done-criterion in turn and shows what you ran and what it printed.
- The crew-work skill is your playbook.`;
