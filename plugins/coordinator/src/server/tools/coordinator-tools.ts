// The plugin's agent tools. Every call resolves the caller's role from the plugin's database by its
// thread id, never from the thread's metadata, which any client, plugin or the thread's own agent
// can write. A coordinating thread gets them all; a crew thread reads memory and hands off.
import type { PluginAgentToolContext, PluginAgentToolResult } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { briefSchema, doneCriteriaSchema, placementOf, requestedPlacementSchema, titlesOf, type Crew, type PlacementFacts } from "../../model/crew.ts";
import { optionsSchema, questionSchema } from "../../model/decision.ts";
import { memoryContentSchema, memoryFileSchema, memoryVersionSchema } from "../../model/memory-file.ts";
import { AT_FORMS, parseAt, parseEvery, reminderIdSchema, reminderNoteSchema } from "../../model/reminder.ts";
import { crewIdSchema, type CoordinatorId, type CrewId, type Role } from "../../model/role.ts";
import type { BoardReader } from "../crew/board/board.ts";
import { isStarted, type Crews } from "../crew/crews.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store.ts";
import { boardText, closeText, detailText, startText, supersedeText } from "./crew-text.ts";
import { VERDICT } from "../verify/verdict-tool.ts";
import { HANDOFF } from "./crew-tools.ts";
import { openDecisionsText, remindersText, reminderText, updatesText } from "./inbox-text.ts";
import { catchUpText, readText, writeResult } from "./memory-text.ts";
import { failed, type ToolsBb } from "./tool-kit.ts";

const CATCH_UP = "crew_catch_up";
const MEMORY_READ = "crew_memory_read";
const MEMORY_WRITE = "crew_memory_write";
const START = "crew_start";
const MESSAGE = "crew_message";
const READ = "crew_read";
const CLOSE = "crew_close";
const REMIND = "crew_remind";
const ASK_USER = "crew_ask_user";

/** What configure offers a coordinating thread. */
export const COORDINATOR_TOOLS = [CATCH_UP, MEMORY_READ, MEMORY_WRITE, START, MESSAGE, READ, CLOSE, REMIND, ASK_USER];
/** What configure offers a crew thread: its coordinating thread's memory, read only, and its handoff. */
export const CREW_TOOLS = [MEMORY_READ, HANDOFF];
/** What configure offers a verifier thread: its coordinating thread's memory, read only, and its verdict. */
export const VERIFIER_TOOLS = [MEMORY_READ, VERDICT];

type Deps = {
  store: Pick<Store, "roleOfThread" | "crew" | "crews" | "handoff" | "reminders" | "insertReminder" | "cancelReminder" | "decision" | "decisions" | "insertDecision">;
  inbox: Pick<Inbox, "takeUnread">;
  memory: MemoryRoot;
  crews: Pick<Crews, "start" | "supersede" | "message" | "detail" | "close">;
  board: Pick<BoardReader, "rows">;
  /** What bb says about where the coordinating thread's crews can run, read when crew_start names a placement. */
  placementFacts(id: CoordinatorId): Promise<PlacementFacts>;
  /** Runs after a decision is asked, to show it on the coordinating thread's board. */
  onChange(id: CoordinatorId): void;
};

export function registerCoordinatorTools(bb: ToolsBb, { store, inbox, memory, crews, board, placementFacts, onChange }: Deps): void {
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
      "Catch up: returns every update since your last catch-up in full (crews' handoffs, a done one with its verifier's verdict, crews that failed, wait on the user or stopped without a handoff, your reminders that came due, the user's answers to your questions, and the user's memory edits and verification switch), then the board (every crew you started, under Needs you, Ready for review, Verifying, Working, Idle or Done, with its thread and branch), the questions still waiting for the user, your reminders with their ids, and your memory files (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md) in full, each with its version, and names any other memory file. Each update is returned once. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: forCoordinator(CATCH_UP, async (id) => {
      const updates = updatesText(inbox.takeUnread(id), { titles: titlesOf(store.crews(id)), handoff: store.handoff, decision: store.decision });
      // why caught: the updates and the memory are still worth reading when bb's thread list can't be.
      const rows = await board.rows(id).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      return `${updates}\n\n${boardText(rows)}\n\n${openDecisionsText(store.decisions(id))}\n\n${remindersText(store.reminders(id))}\n\n${catchUpText(memory.of(id))}`;
    }),
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as PLAN.md or notes/api.md. Returns its text and its version.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return failed(`${MEMORY_READ} is refused: this thread is not a coordinating thread, nor one of its crew or verifiers, so it has no memory to read. Carry on without it.`);
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
      "Start a crew: a child thread of yours that does one piece of the work in its own environment, on its own branch. Its first message is your brief, the done-criteria, and CREW.md and MEMORY.md as they are when it starts. Returns the crew's id (c1, c2…) and a link to its thread. With draft: true it only saves the crew as a draft on the user's board, where they start it, or edit it first: use that whenever the user asked you to propose crews and wait for them. With supersedes it replaces one of your crews with a fresh one: the old crew is stopped and closed, and the new one starts from its title, brief, done-criteria, placement and model, with its latest verifier findings added to the brief.",
    presentation: { label: { pending: "Starting a crew", completed: "Started a crew" }, icon: { glyph: "Workflow" } },
    parameters: z.object({
      title: z.string().trim().min(1).max(80).optional().describe("A short name for the piece of work; it titles the crew's thread. Required unless you give supersedes."),
      brief: briefSchema
        .optional()
        .describe("Everything the crew needs to start without asking: the goal, the context, the constraints, where to look. Required unless you give supersedes."),
      doneCriteria: doneCriteriaSchema
        .optional()
        .describe("1 to 12 criteria, each checkable by running something: a test, a command and its output, a page that shows a thing. Required unless you give supersedes."),
      placement: requestedPlacementSchema
        .optional()
        .describe(
          'worktree (the default): a fresh worktree of the default branch on your machine. provider: an environment provider such as boat-sandbox, named by environmentProviderId, with machineInputs for the machine it makes, such as {"preset": "small"} for boat-sandbox (`bb environment providers --json` shows each one\'s machineInputs). A sandbox crew gets its own new branch from the default branch.',
        ),
      draft: z.boolean().default(false).describe("true: save it as a draft for the user to start, or edit and start, and start no thread now."),
      supersedes: crewIdSchema
        .optional()
        .describe("The id of one of your crews to replace, typically one whose work failed verification twice. Leave out title, brief, doneCriteria and placement to keep its own; any you give replace them."),
    }),
    execute: forCoordinator(START, async (id, { supersedes, draft, placement: requested, ...fields }) => {
      const placement = requested === undefined ? undefined : placementOf(requested, await placementFacts(id));
      if (placement !== undefined && "refused" in placement) return failed(placement.refused);
      if (supersedes !== undefined) {
        const old = store.crew(id, supersedes);
        if (old === null) return failed(`You have no crew ${supersedes}. crew_catch_up lists your crews.`);
        if (!isStarted(old)) return failed(`${supersedes} is a draft that never ran, so there is nothing to replace: the user edits or starts it on the board, or close it with crew_close.`);
        return supersedeText(supersedes, await crews.supersede(old, { ...fields, placement, draft }));
      }
      const { title, brief, doneCriteria } = fields;
      if (title === undefined || brief === undefined || doneCriteria === undefined) return failed(`${START} needs a title, a brief and doneCriteria to start a new crew; only with supersedes can you leave them out.`);
      return startText(await crews.start(id, { title, brief, doneCriteria, placement: placement ?? WORKTREE, execution: null, draft }));
    }),
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
    description: "Read one of your crews whole: where it is on the board and why, its thread and branch, its brief and done-criteria, its latest handoff in full, and its latest answer.",
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

  bb.agents.registerTool({
    name: REMIND,
    description:
      "Set yourself a reminder instead of waiting or polling: when it comes due, the plugin wakes you with its note. Give note and at, and every to repeat it; or give only cancel to cancel one. Due reminders are checked once a minute. A repeating one that was missed several times (the server was down) wakes you once, then keeps its times. crew_catch_up lists your reminders with their ids.",
    presentation: { label: { pending: "Updating reminders", completed: "Updated reminders" }, icon: { glyph: "Clock" } },
    parameters: z.object({
      note: reminderNoteSchema.optional().describe("What to do when it comes due, in one line, such as \"check on c1\". It wakes you as written. Required unless you give cancel."),
      at: z.string().optional().describe(`When it first comes due: ${AT_FORMS}. Required unless you give cancel.`),
      every: z.string().optional().describe('How often it comes due again after that, such as "30m", "2h" or "every 1d". Leave it out for a one-off.'),
      cancel: reminderIdSchema.optional().describe("The id of one of your reminders to cancel, such as r3. Give nothing else with it."),
    }),
    execute: forCoordinator(REMIND, (id, { note, at, every, cancel }) => {
      if (cancel !== undefined) {
        if (note !== undefined || at !== undefined || every !== undefined) return failed(`${REMIND} either sets a reminder (note, at and every) or cancels one (cancel alone), not both.`);
        const cancelled = store.cancelReminder(id, cancel);
        return cancelled === null ? failed(`You have no reminder ${cancel}. crew_catch_up lists your reminders.`) : `Cancelled ${reminderText(cancelled)}. It won't wake you.`;
      }
      if (note === undefined || at === undefined) return failed(`${REMIND} needs a note and at to set a reminder, or cancel alone to cancel one.`);
      const now = Date.now();
      const dueAt = parseAt(at, now);
      if (!dueAt.ok) return failed(dueAt.error);
      const everyMs = every === undefined ? null : parseEvery(every);
      if (everyMs?.ok === false) return failed(everyMs.error);
      const reminder = store.insertReminder(id, { note, dueAt: dueAt.ms, everyMs: everyMs?.ms ?? null });
      return `Set ${reminderText(reminder)}. It wakes you with its note when it comes due; cancel it with ${REMIND} and cancel: "${reminder.id}".`;
    }),
  });

  bb.agents.registerTool({
    name: ASK_USER,
    description:
      "Ask the user to decide something only they can: a one-line question and up to five short options. It goes on their board under Needs you, with a button for each option and a field to answer in their own words, and returns at once: carry on with other work, or end your turn. Their answer wakes you, and crew_catch_up returns it with your question. crew_catch_up lists the questions still waiting, so don't ask one twice. Not for a crew's own question or approval: that waits in the crew's thread, for the user.",
    presentation: { label: { pending: "Asking the user", completed: "Asked the user" }, icon: { glyph: "MessageCircleQuestion" } },
    parameters: z.object({
      question: questionSchema.describe("What the user decides, in one line, such as \"Target main or release/2?\"."),
      options: optionsSchema.default([]).describe("Up to five answers to pick from, each a few words, such as [\"main\", \"release/2\"]. Leave it out when only their own words will do."),
    }),
    execute: forCoordinator(ASK_USER, (id, { question, options }) => {
      const decision = store.insertDecision(id, { question, options }, Date.now());
      onChange(id);
      return `Asked the user ${decision.id} on their board, under Needs you. Carry on with other work, or end your turn: their answer wakes you, and crew_catch_up returns it.`;
    }),
  });
}

/** Whose memory a role reads. why the return type: a new role kind fails to compile here until it is given one. */
function memoryOwner(role: Role): CoordinatorId {
  switch (role.kind) {
    case "coordinator":
    case "crew":
    case "verifier":
      return role.coordinatorId;
  }
}

const WORKTREE = { kind: "worktree" } as const;

const refused = (tool: string): PluginAgentToolResult =>
  failed(`${tool} is refused: only a coordinating thread can use it, and this thread was not started as one. Carry on without it.`);
