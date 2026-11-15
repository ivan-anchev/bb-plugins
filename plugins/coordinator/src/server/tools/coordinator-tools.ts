// The coordinating thread's tools. Every call resolves the caller's role from the plugin's
// database by its thread id, never from the thread's metadata, which any client, plugin or the
// thread's own agent can write.
import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { CoordinatorId, Role } from "../../model/role.ts";
import { memoryFileSchema, type MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";

const CATCH_UP = "crew_catch_up";
const MEMORY_READ = "crew_memory_read";

/** What configure offers a coordinating thread. */
export const COORDINATOR_TOOLS = [CATCH_UP, MEMORY_READ];

// The part of bb the tools use: registering a tool whose parameters are a zod schema.
type ToolsBb = {
  agents: {
    registerTool<Schema extends z.ZodType>(
      tool: PluginAgentToolRegistrationBase & {
        parameters: Schema;
        execute(params: z.output<Schema>, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
      },
    ): void;
  };
};
type ToolStore = Pick<Store, "roleOfThread">;

export function registerCoordinatorTools(bb: ToolsBb, store: ToolStore, memory: MemoryRoot): void {
  bb.agents.registerTool({
    name: CATCH_UP,
    description:
      "Catch up on your memory: returns your memory files (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md) in full. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: (_input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "coordinator") return refused(CATCH_UP);
      return memory.of(role.coordinatorId).catchUp();
    },
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as PLAN.md or notes/api.md.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return refused(MEMORY_READ);
      return memory.of(memoryOwner(role)).read(file) ?? failed(`There is no memory file named ${file}.`);
    },
  });
}

/** Whose memory a role reads. why the return type: a new role kind fails to compile here until it is given one. */
function memoryOwner(role: Role): CoordinatorId {
  switch (role.kind) {
    case "coordinator":
      return role.coordinatorId;
  }
}

const refused = (tool: string): PluginAgentToolResult =>
  failed(`${tool} is refused: this thread was not started as a coordinating thread, so it has no memory. Carry on without it.`);

const failed = (text: string): PluginAgentToolResult => ({ content: [{ type: "text", text }], isError: true });
