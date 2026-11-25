// The regional manager's tools that are about the whole crew rather than one issue or agent:
// catching up, its memory, its reminders, its questions to the user and ending a quiet turn. Every call resolves the
// caller's role from the plugin's database by its thread id, never from the thread's metadata, which
// any client, plugin or the thread's own agent can write.
import { z } from "zod";
import { waitingDecisions } from "../../model/board/board-groups.ts";
import { isOpen, optionsSchema, questionSchema } from "../../model/decision.ts";
import { issueIdSchema, type IssueId } from "../../model/issue/issue.ts";
import { memoryContentSchema, memoryFileSchema, memoryVersionSchema } from "../../model/memory-file.ts";
import { AT_FORMS, parseAt, parseEvery, reminderIdSchema, reminderNoteSchema } from "../../model/reminder.ts";
import type { CoordinatorId, Role } from "../../model/role.ts";
import { capQuestionsOf } from "../../model/verdict/rounds/cap.ts";
import type { BoardReader } from "../board/board.ts";
import type { Inbox } from "../inbox/inbox.ts";
import { boardText } from "../issues/issue-text.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import { replacedFileReadRefusal, replacedFileWriteRefusal } from "../memory/memory-upgrade.ts";
import type { Store } from "../store/store.ts";
import { openDecisionsText, remindersText, reminderText, updatesText } from "./inbox-text.ts";
import { catchUpText, readText, writeResult } from "./memory-text.ts";
import { failed, forManager, type ToolsBb } from "./tool-kit.ts";

const CATCH_UP = "crew_catch_up";
export const MEMORY_READ = "crew_memory_read";
const MEMORY_WRITE = "crew_memory_write";
const REMIND = "crew_remind";
const ASK_USER = "crew_ask_user";
const END_TURN = "crew_end_turn";

/** What configure offers a regional manager of these tools. */
export const CREW_TOOLS = [CATCH_UP, MEMORY_READ, MEMORY_WRITE, REMIND, ASK_USER, END_TURN];

type Deps = {
  store: Pick<Store, "roleOfThread" | "issue" | "issues" | "agent" | "agents" | "handoff" | "check" | "reminders" | "insertReminder" | "cancelReminder" | "decision" | "decisions" | "insertDecision" | "comment" | "record">;
  inbox: Pick<Inbox, "unread" | "markRead">;
  memory: MemoryRoot;
  board: Pick<BoardReader, "issues">;
  /** Runs after a decision is asked, to show it on the regional manager's board. */
  onChange(id: CoordinatorId): void;
};

export function registerCrewTools(bb: ToolsBb & { pluginId: string }, { store, inbox, memory, board, onChange }: Deps): void {
  bb.agents.registerTool({
    name: CATCH_UP,
    description:
      "Catch up: returns every update since your last catch-up in full (agents' handoffs, a done one with its verifier's verdict, agents that failed, wait on the user, stopped without a handoff or ended before their work was done, issues unblocked, pull requests, your reminders that came due, the user's answers to your questions, the user's comments on issues and your agents' replies there, and the user's memory edits and verification switch), then the board (every issue you filed, under Needs you, In review, Verifying, Reviewing, In progress, Todo, Backlog, Done or Canceled, with its agent, thread and branch, what blocks it and what it blocks) and the issues ready to start (in Todo, not blocked), the questions still waiting for the user, your reminders with their ids, and your memory files (MEMORY.md, GOAL.md, NOTES.md, RULES.md, CREW.md) in full, each with its version, and names any other memory file. Each update is returned once. Call it first on every wake.",
    presentation: { label: { pending: "Catching up", completed: "Caught up" }, icon: { glyph: "Workflow" } },
    parameters: z.object({}),
    execute: forManager(store, CATCH_UP, async (id, _, { signal }) => {
      // why read before the board is: every event returned is then older than the read, so what is said of it (a failure's cap question, what locks its issue) is in the read. One recorded during the read waits for the next catch-up, whose doorbell it rings.
      const unread = inbox.unread(id);
      // why caught: the updates and the memory are still worth reading when bb's thread list can't be.
      const read = await board.issues(id).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
      const issues = "error" in read ? read : read.reads;
      const readOf = (issueId: IssueId) => ("error" in issues ? null : (issues.find(({ view }) => view.issue.id === issueId) ?? null));
      // why the board's own read when there is one: its decisions and its issues are one snapshot. Without it, closed issues can't be told, so every unanswered decision is listed.
      const decisions = "error" in read ? store.decisions(id) : read.decisions;
      const waiting = "error" in read ? decisions.filter(isOpen) : waitingDecisions(decisions, read.reads.map(({ view }) => ({ id: view.issue.id, status: view.status })));
      const updates = updatesText(unread, {
        titles: new Map(store.issues(id).map((issue) => [issue.id, issue.title])),
        handoff: store.handoff,
        check: store.check,
        agents: () => store.agents(id),
        decision: store.decision,
        comment: store.comment,
        // why the store when bb's thread list couldn't be read: there is no view for the record to agree with.
        record: (issueId) => readOf(issueId)?.record ?? store.record(id, issueId),
        view: (issueId) => readOf(issueId)?.view ?? null,
        capQuestions: (issueId) => capQuestionsOf(decisions, issueId),
      });
      const text = `${updates}\n\n${boardText(issues, bb.pluginId)}\n\n${openDecisionsText(waiting)}\n\n${remindersText(store.reminders(id))}\n\n${catchUpText(memory.of(id))}`;
      // why marked read only now, and not once the call was aborted: an answer nobody receives must leave its updates for the next catch-up.
      if (!signal.aborted) inbox.markRead(id, unread);
      return text;
    }),
  });

  bb.agents.registerTool({
    name: MEMORY_READ,
    description: "Read one memory file by its name in the memory folder, such as NOTES.md or notes/api.md. Returns its text and its version.",
    presentation: { label: { pending: "Reading memory", completed: "Read memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema }),
    execute: ({ file }, { threadId }) => {
      const role = store.roleOfThread(threadId);
      if (role === null) return failed(`${MEMORY_READ} is refused: this thread is not a regional manager, nor one of its agents or verifiers, so it has no memory to read. Carry on without it.`);
      const { text } = memory.of(memoryOwner(role)).read(file);
      const replaced = replacedFileReadRefusal(file, text !== null);
      if (replaced !== null) return failed(replaced);
      return text === null ? failed(`There is no memory file named ${file}.`) : readText(file, text);
    },
  });

  bb.agents.registerTool({
    name: MEMORY_WRITE,
    description:
      "Write one memory file whole, such as NOTES.md or notes/api.md. baseVersion is the version crew_catch_up or crew_memory_read last gave for that file, or null to create a new one. If the file changed since (the user edits these files too), nothing is written and you get its current text and version: merge your change into it and write again.",
    presentation: { label: { pending: "Writing memory", completed: "Wrote memory" }, icon: { glyph: "FileText" } },
    parameters: z.object({ file: memoryFileSchema, content: memoryContentSchema, baseVersion: memoryVersionSchema }),
    execute: forManager(store, MEMORY_WRITE, (id, { file, content, baseVersion }) => {
      const replaced = replacedFileWriteRefusal(file);
      return replaced === null ? writeResult(file, memory.of(id).write(file, content, baseVersion)) : failed(replaced);
    }),
  });

  bb.agents.registerTool({
    name: REMIND,
    description:
      "Set yourself a reminder instead of waiting or polling: when it comes due, the plugin wakes you with its note. Give note and at, and every to repeat it; or give only cancel to cancel one. Due reminders are checked once a minute. A repeating one that was missed several times (the server was down) wakes you once, then keeps its times. crew_catch_up lists your reminders with their ids.",
    presentation: { label: { pending: "Updating reminders", completed: "Updated reminders" }, icon: { glyph: "Clock" } },
    parameters: z.object({
      note: reminderNoteSchema.optional().describe("What to do when it comes due, in one line, such as \"check on BBP-1\". It wakes you as written. Required unless you give cancel."),
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
      "Ask the user to decide something only they can: a one-line question and up to five short options. It goes on their board under Needs you, with a button for each option and a field to answer in their own words, and returns at once: carry on with other work, or end your turn. Their answer wakes you, and crew_catch_up returns it with your question. crew_catch_up lists the questions still waiting, so don't ask one twice. Name the issue the question is about, so the question and its answer are recorded on it: it flags the issue Needs you until the user answers, and stays among the issue's decisions, which issue_read and the agents you start on it see. Answered, it leaves the board; a question on no issue is then kept nowhere but in what you write down, in NOTES.md or an issue. Not for an agent's own question or approval: that waits in the agent's thread, for the user.",
    presentation: { label: { pending: "Asking the user", completed: "Asked the user" }, icon: { glyph: "MessageCircleQuestion" } },
    parameters: z.object({
      question: questionSchema.describe("What the user decides, in one line, such as \"Target main or release/2?\"."),
      options: optionsSchema.default([]).describe("Up to five answers to pick from, each a few words, such as [\"main\", \"release/2\"]. Leave it out when only their own words will do."),
      issue: issueIdSchema.optional().describe("The issue the question is about, such as BBP-4: it flags the issue Needs you until the user answers, and the question and its answer are recorded among its decisions."),
    }),
    execute: forManager(store, ASK_USER, (id, { question, options, issue }) => {
      if (issue !== undefined && store.issue(id, issue) === null) return failed(`You have no issue ${issue}. crew_catch_up lists your issues.`);
      const decision = store.insertDecision(id, { question, options, issueId: issue ?? null }, Date.now());
      onChange(id);
      return `Asked the user ${decision.id} on their board, under Needs you. Carry on with other work, or end your turn: their answer wakes you, and crew_catch_up returns it.`;
    }),
  });

  // why no side effect: the turn ends when the provider stops writing. Codex stops by itself; on
  // Claude Code a PostToolUse hook returning {"continue": false} for this tool ends it (BBP-20).
  // Stopping the thread instead would leave a "Stopped manually" row and cold-start the next wake.
  bb.agents.registerTool({
    name: END_TURN,
    description:
      "End a turn that changes nothing for the user, instead of replying: a wake you expected, one for something the user did themselves, or one that only confirms work under way. Do your bookkeeping first, then call it last, with the reason in one line, such as \"BBP-4's CI passed; its agent is still shipping it\". After it, write nothing: no text, no whitespace and no other tool call.",
    presentation: { label: { pending: "Ending the turn", completed: "Ended the turn" }, icon: { glyph: "CircleCheck" } },
    parameters: z.object({ reason: z.string().min(1).max(200).describe("Why nothing here needs the user, in one line.") }),
    execute: forManager(store, END_TURN, (_id, { reason }) => `${reason}\n\nYour turn is over. Write nothing more: no text, no whitespace and no other tool call.`),
  });
}

/** Whose memory a role reads. why the return type: a new role kind fails to compile here until it is given one. */
function memoryOwner(role: Role): CoordinatorId {
  switch (role.kind) {
    case "coordinator":
    case "agent":
    case "verifier":
    case "reviewer":
      return role.coordinatorId;
  }
}
