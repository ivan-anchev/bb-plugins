// The coordinating thread's tools. Every call resolves the caller's role from the plugin's
// database by its thread id, never from the thread's metadata, which any client, plugin or the
// thread's own agent can write.
import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { memoryContentSchema, memoryFileSchema, memoryVersionSchema } from "../../model/memory-file.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";
import { catchUpText, readText, writeResult } from "./memory-text.ts";

const CATCH_UP = "crew_catch_up";
const MEMORY_READ = "crew_memory_read";
const MEMORY_WRITE = "crew_memory_write";

/** What configure offers a coordinating thread. */
export const COORDINATOR_TOOLS = [CATCH_UP, MEMORY_READ, MEMORY_WRITE];

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
      "Catch up on your memory: returns your memory files (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md) in full, each with its version, and names any other memory file. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: (_input, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "coordinator") return refused(CATCH_UP);
      return catchUpText(memory.of(role.coordinatorId));
    },
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as PLAN.md or notes/api.md. Returns its text and its version.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return refused(MEMORY_READ);
      const { text } = memory.of(memoryOwner(role)).read(file);
      return text === null ? failed(`There is no memory file named ${file}.`) : readText(file, text);
    },
  });

  bb.agents.registerTool({
    name: MEMORY_WRITE,
    description:
      "Write one memory file whole, such as PLAN.md or notes/api.md. baseVersion is the version crew_catch_up or crew_memory_read last gave for that file, or null to create a new one. If the file changed since (the user edits these files too), nothing is written and you get its current text and version: merge your change into it and write again.",
    presentation: { label: { pending: "Writing memory", completed: "Wrote memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema, content: memoryContentSchema, baseVersion: memoryVersionSchema }),
    execute: ({ file, content, baseVersion }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role?.kind !== "coordinator") return refused(MEMORY_WRITE);
      return writeResult(file, memory.of(role.coordinatorId).write(file, content, baseVersion));
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
