// The plugin's agent tools. Every call resolves the caller's role from the plugin's database by its
// thread id, never from the thread's metadata, which any client, plugin or the thread's own agent
// can write. A coordinating thread gets them all; a crew thread only reads memory.
import type { PluginAgentToolContext, PluginAgentToolRegistrationBase, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { briefSchema, doneCriteriaSchema, requestedPlacementSchema, type Crew } from "../../model/crew.ts";
import { memoryContentSchema, memoryFileSchema, memoryVersionSchema } from "../../model/memory-file.ts";
import { crewIdSchema, type CoordinatorId, type CrewId, type Role } from "../../model/role.ts";
import type { BoardReader } from "../crew/board.ts";
import { isStarted, type Crews } from "../crew/crews.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";
import { boardText, closeText, detailText, startText } from "./crew-text.ts";
import { catchUpText, readText, writeResult } from "./memory-text.ts";

const CATCH_UP = "crew_catch_up";
const MEMORY_READ = "crew_memory_read";
const MEMORY_WRITE = "crew_memory_write";
const START = "crew_start";
const MESSAGE = "crew_message";
const READ = "crew_read";
const CLOSE = "crew_close";

/** What configure offers a coordinating thread. */
export const COORDINATOR_TOOLS = [CATCH_UP, MEMORY_READ, MEMORY_WRITE, START, MESSAGE, READ, CLOSE];
/** What configure offers a crew thread: its coordinating thread's memory, read only. */
export const CREW_TOOLS = [MEMORY_READ];

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

type Deps = {
  store: Pick<Store, "roleOfThread" | "crew">;
  memory: MemoryRoot;
  crews: Pick<Crews, "start" | "message" | "detail" | "close">;
  board: Pick<BoardReader, "rows">;
};

export function registerCoordinatorTools(bb: ToolsBb, { store, memory, crews, board }: Deps): void {
  /** The caller's coordinating thread, or null when the caller isn't one. */
  function coordinatorOf(threadId: string): CoordinatorId | null {
    const role = store.roleOfThread(threadId);
    return role?.kind === "coordinator" ? role.coordinatorId : null;
  }

  /** The tool runs only for a coordinating thread; any other caller is refused. */
  function forCoordinator<Input>(tool: string, run: (id: CoordinatorId, input: Input) => PluginAgentToolResult | Promise<PluginAgentToolResult>) {
    return (input: Input, { threadId }: PluginAgentToolContext) => {
      const id = coordinatorOf(threadId);
      return id === null ? refused(tool) : run(id, input);
    };
  }

  /** The tool runs on one of the caller's crews; an id it has no crew by is refused. */
  function forCrew<Input extends { crewId: CrewId }>(tool: string, run: (crew: Crew, input: Input) => PluginAgentToolResult | Promise<PluginAgentToolResult>) {
    return forCoordinator<Input>(tool, (id, input) => {
      const crew = store.crew(id, input.crewId);
      return crew === null ? failed(`You have no crew ${input.crewId}. crew_catch_up lists your crews.`) : run(crew, input);
    });
  }

  bb.agents.registerTool({
    name: CATCH_UP,
    description:
      "Catch up: returns the board (every crew you started, under Needs you, Working, Idle or Done, with its thread and branch) and your memory files (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md) in full, each with its version, and names any other memory file. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: forCoordinator(CATCH_UP, async (id) => {
      // why caught: the memory is still worth reading when bb's thread list can't be.
      const rows = await board.rows(id).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      return `${boardText(rows)}\n\n${catchUpText(memory.of(id))}`;
    }),
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as PLAN.md or notes/api.md. Returns its text and its version.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return failed(`${MEMORY_READ} is refused: this thread is neither a coordinating thread nor one of its crew, so it has no memory to read. Carry on without it.`);
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
    execute: forCoordinator(MEMORY_WRITE, (id, { file, content, baseVersion }) => writeResult(file, memory.of(id).write(file, content, baseVersion))),
  });

  bb.agents.registerTool({
    name: START,
    description:
      "Start a crew: a child thread of yours that does one piece of the work in its own environment, on its own branch. Its first message is your brief, the done-criteria, and CREW.md and MEMORY.md as they are when it starts. Returns the crew's id (c1, c2…) and a link to its thread. With draft: true it only saves the crew as a draft on the user's board, where they start it, or edit it first: use that whenever the user asked you to propose crews and wait for them.",
    presentation: { label: { pending: "Starting a crew", completed: "Started a crew" }, icon: { glyph: "Workflow" } },
    parameters: z.object({
      title: z.string().trim().min(1).max(80).describe("A short name for the piece of work; it titles the crew's thread."),
      brief: briefSchema.describe("Everything the crew needs to start without asking: the goal, the context, the constraints, where to look."),
      doneCriteria: doneCriteriaSchema.describe("1 to 12 criteria, each checkable by running something: a test, a command and its output, a page that shows a thing."),
      placement: requestedPlacementSchema
        .default({ kind: "worktree" })
        .describe("worktree (the default): a fresh worktree of the default branch on your machine. provider: an environment provider such as boat-sandbox, named by environmentProviderId."),
      draft: z.boolean().default(false).describe("true: save it as a draft for the user to start, or edit and start, and start no thread now."),
    }),
    execute: forCoordinator(START, async (id, request) => startText(await crews.start(id, request))),
  });

  bb.agents.registerTool({
    name: MESSAGE,
    description: "Message one of your crews. It arrives in the crew's thread as a message from you, not from the user: it steers a running turn, or starts a new one.",
    presentation: { label: { pending: "Messaging a crew", completed: "Messaged a crew" }, icon: { glyph: "SideChat" } },
    parameters: z.object({ crewId: crewIdSchema, text: z.string().trim().min(1).max(20_000) }),
    execute: forCrew(MESSAGE, async (crew, { text }) => {
      if (crew.closed !== null) return failed(`${crew.id} is ${crew.closed.kind}, so it takes no more messages. Start a new crew for more work.`);
      if (!isStarted(crew)) return failed(`${crew.id} is a draft with no thread to message: it waits for the user to start it.`);
      const delivery = await crews.message(crew, text);
      return delivery === "sent" ? `Sent to ${crew.id}.` : `Queued for ${crew.id}: it is waiting on the user or busy, and gets your message once it is free.`;
    }),
  });

  bb.agents.registerTool({
    name: READ,
    description: "Read one of your crews whole: where it is on the board and why, its thread and branch, its brief and done-criteria, and its latest answer.",
    presentation: { label: { pending: "Reading a crew", completed: "Read a crew" }, icon: { glyph: "FileText" } },
    parameters: z.object({ crewId: crewIdSchema }),
    execute: forCrew(READ, async (crew) => detailText(await crews.detail(crew))),
  });

  bb.agents.registerTool({
    name: CLOSE,
    description:
      "Close one of your crews, which moves it to Done. stop: stop its thread's turn. resolve: accept its work and leave its thread as it is. archive: archive its thread.",
    presentation: { label: { pending: "Closing a crew", completed: "Closed a crew" }, icon: { glyph: "Check" } },
    parameters: z.object({ crewId: crewIdSchema, action: z.enum(["stop", "resolve", "archive"]) }),
    execute: forCrew(CLOSE, async (crew, { action }) => closeText(crew.id, await crews.close(crew, action))),
  });
}

/** Whose memory a role reads. why the return type: a new role kind fails to compile here until it is given one. */
function memoryOwner(role: Role): CoordinatorId {
  switch (role.kind) {
    case "coordinator":
    case "crew":
      return role.coordinatorId;
  }
}

const refused = (tool: string): PluginAgentToolResult =>
  failed(`${tool} is refused: only a coordinating thread can use it, and this thread was not started as one. Carry on without it.`);

const failed = (text: string): PluginAgentToolResult => ({ content: [{ type: "text", text }], isError: true });
