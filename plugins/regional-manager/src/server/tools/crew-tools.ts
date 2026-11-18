// The regional manager's tools that are about the whole crew rather than one issue or agent:
// catching up, its memory, its reminders and its questions to the user. Every call resolves the
// caller's role from the plugin's database by its thread id, never from the thread's metadata, which
// any client, plugin or the thread's own agent can write.
import { z } from "zod";
import { optionsSchema, questionSchema } from "../../model/decision.ts";
import { issueIdSchema } from "../../model/issue/issue.ts";
import { memoryContentSchema, memoryFileSchema, memoryVersionSchema } from "../../model/memory-file.ts";
import { AT_FORMS, parseAt, parseEvery, reminderIdSchema, reminderNoteSchema } from "../../model/reminder.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import type { BoardReader } from "../board/board.ts";
import type { Inbox } from "../inbox/inbox.ts";
import { boardText } from "../issues/issue-text.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import type { Store } from "../store/store.ts";
import { openDecisionsText, remindersText, reminderText, updatesText } from "./inbox-text.ts";
import { catchUpText, readText, writeResult } from "./memory-text.ts";
import { failed, forManager, type ToolsBb } from "./tool-kit.ts";

const CATCH_UP = "crew_catch_up";
export const MEMORY_READ = "crew_memory_read";
const MEMORY_WRITE = "crew_memory_write";
const REMIND = "crew_remind";
const ASK_USER = "crew_ask_user";

/** What configure offers a regional manager of these tools. */
export const CREW_TOOLS = [CATCH_UP, MEMORY_READ, MEMORY_WRITE, REMIND, ASK_USER];

type Deps = {
  store: Pick<Store, "roleOfThread" | "issue" | "issues" | "agent" | "agents" | "handoff" | "check" | "reminders" | "insertReminder" | "cancelReminder" | "decision" | "decisions" | "insertDecision">;
  inbox: Pick<Inbox, "takeUnread">;
  memory: MemoryRoot;
  board: Pick<BoardReader, "issues">;
  /** Runs after a decision is asked, to show it on the regional manager's board. */
  onChange(id: CoordinatorId): void;
};

export function registerCrewTools(bb: ToolsBb, { store, inbox, memory, board, onChange }: Deps): void {
  bb.agents.registerTool({
    name: CATCH_UP,
    description:
      "Catch up: returns every update since your last catch-up in full (agents' handoffs, a done one with its verifier's verdict, agents that failed, wait on the user, stopped without a handoff or ended before their work was done, issues unblocked, pull requests, your reminders that came due, the user's answers to your questions, and the user's memory edits and verification switch), then the board (every issue you filed, under Needs you, In review, Verifying, In progress, Todo, Backlog, Done or Canceled, with its agent, thread and branch, and what blocks it) and the issues ready to start (in Todo, not blocked), the questions still waiting for the user, your reminders with their ids, and your memory files (MEMORY.md, GOAL.md, PLAN.md, PREFERENCES.md, CREW.md, DIGEST.md) in full, each with its version, and names any other memory file. Each update is returned once. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: forManager(store, CATCH_UP, async (id) => {
      // why caught: the updates and the memory are still worth reading when bb's thread list can't be.
      const issues = await board.issues(id).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      const updates = updatesText(inbox.takeUnread(id), {
        titles: new Map(store.issues(id).map((issue) => [issue.id, issue.title])),
        handoff: store.handoff,
        check: store.check,
        agents: () => store.agents(id),
        decision: store.decision,
        view: (issueId) => ("error" in issues ? null : (issues.find(({ view }) => view.issue.id === issueId)?.view ?? null)),
      });
      return `${identityText(id)}\n\n${updates}\n\n${boardText(issues)}\n\n${openDecisionsText(store.decisions(id))}\n\n${remindersText(store.reminders(id))}\n\n${catchUpText(memory.of(id))}`;
    }),
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as PLAN.md or notes/api.md. Returns its text and its version.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return failed(`${MEMORY_READ} is refused: this thread is not a regional manager, nor one of its agents or verifiers, so it has no memory to read. Carry on without it.`);
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
    execute: forManager(store, MEMORY_WRITE, (id, { file, content, baseVersion }) => writeResult(file, memory.of(id).write(file, content, baseVersion))),
  });

  bb.agents.registerTool({
    name: REMIND,
    description:
      "Set yourself a reminder instead of waiting or polling: when it comes due, the plugin wakes you with its note. Give note and at, and every to repeat it; or give only cancel to cancel one. Due reminders are checked once a minute. A repeating one that was missed several times (the server was down) wakes you once, then keeps its times. crew_catch_up lists your reminders with their ids.",
    presentation: { label: { pending: "Updating reminders", completed: "Updated reminders" }, icon: { glyph: "Clock" } },
    parameters: z.object({
      note: reminderNoteSchema.optional().describe("What to do when it comes due, in one line, such as \"check on i1\". It wakes you as written. Required unless you give cancel."),
      at: z.string().optional().describe(`When it first comes due: ${AT_FORMS}. Required unless you give cancel.`),
      every: z.string().optional().describe('How often it comes due again after that, such as "30m", "2h" or "every 1d". Leave it out for a one-off.'),
      cancel: reminderIdSchema.optional().describe("The id of one of your reminders to cancel, such as r3. Give nothing else with it."),
    }),
    execute: forManager(store, REMIND, (id, { note, at, every, cancel }) => {
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
      "Ask the user to decide something only they can: a one-line question and up to five short options. It goes on their board under Needs you, with a button for each option and a field to answer in their own words, and returns at once: carry on with other work, or end your turn. Their answer wakes you, and crew_catch_up returns it with your question. crew_catch_up lists the questions still waiting, so don't ask one twice. Name an issue when the question is about one: it shows under Needs you until the user answers. Not for an agent's own question or approval: that waits in the agent's thread, for the user.",
    presentation: { label: { pending: "Asking the user", completed: "Asked the user" }, icon: { glyph: "MessageCircleQuestion" } },
    parameters: z.object({
      question: questionSchema.describe("What the user decides, in one line, such as \"Target main or release/2?\"."),
      options: optionsSchema.default([]).describe("Up to five answers to pick from, each a few words, such as [\"main\", \"release/2\"]. Leave it out when only their own words will do."),
      issue: issueIdSchema.optional().describe("The issue the question is about, such as i4: it shows under Needs you until the user answers."),
    }),
    execute: forManager(store, ASK_USER, (id, { question, options, issue }) => {
      if (issue !== undefined && store.issue(id, issue) === null) return failed(`You have no issue ${issue}. crew_catch_up lists your issues.`);
      const decision = store.insertDecision(id, { question, options, issueId: issue ?? null }, Date.now());
      onChange(id);
      return `Asked the user ${decision.id} on their board, under Needs you. Carry on with other work, or end your turn: their answer wakes you, and crew_catch_up returns it.`;
    }),
  });
}

/** Whose memory a role reads. why the return type: a new role kind fails to compile here until it is given one. */
function memoryOwner(role: Role): CoordinatorId {
  switch (role.kind) {
    case "coordinator":
    case "agent":
    case "verifier":
      return role.coordinatorId;
  }
}

/** Who the caller is, where a manager that doubts its role looks: bb status shows no roles. */
const identityText = (id: CoordinatorId): string => `You are regional manager ${id}: the plugin made this thread one when it started it.`;
