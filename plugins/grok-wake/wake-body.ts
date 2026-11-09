import type { PendingInteraction, ThreadResponse } from "./bb-types.ts";
import { z } from "zod";

/** The JSON a target receives: exactly these six fields. */
export const wakeBodySchema = z.object({
  project: z.string(),
  section: z.string().nullable(),
  thread: z.string(),
  event: z.enum(["interaction", "finished", "failed", "test"]),
  title: z.string(),
  summary: z.string(),
});
export type WakeBody = z.infer<typeof wakeBodySchema>;

/** What needs attention on a thread, with the text its summary is cut from. */
export type Attention =
  | { kind: "interaction"; interaction: PendingInteraction }
  | { kind: "finished"; lastAssistantText: string | null }
  | { kind: "failed"; error: string | null };

const SUMMARY_MAX_CHARS = 280;
const SUMMARY_MAX_SENTENCES = 2;

export function wakeBody(thread: ThreadResponse, attention: Attention): WakeBody {
  return {
    project: thread.projectId,
    section: thread.sectionId,
    thread: thread.id,
    event: attention.kind,
    title: threadTitle(thread),
    summary: summarize(attentionText(attention)),
  };
}

export const TEST_BODY: WakeBody = {
  project: "test",
  section: null,
  thread: "test",
  event: "test",
  title: "Grok Wake test",
  summary: "A test event from bb grok-wake test. Nothing needs attention.",
};

function threadTitle(thread: ThreadResponse): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || `Thread ${thread.id.slice(0, 8)}`;
}

function attentionText(attention: Attention): string {
  switch (attention.kind) {
    case "interaction":
      return describeInteraction(attention.interaction);
    case "finished":
      return attention.lastAssistantText?.trim() || "The thread finished its turn.";
    case "failed":
      return attention.error?.trim() || "The thread failed.";
  }
}

type InteractionPayload = PendingInteraction["payload"];
type ExtensionPayload = Extract<InteractionPayload, { kind: `${string}/${string}` }>;

function describeInteraction(interaction: PendingInteraction): string {
  const payload = interaction.payload;
  switch (payload.kind) {
    case "user_question":
      return payload.questions[0]?.prompt.trim() || "The agent has a question.";
    case "approval":
      return describeApproval(payload.subject);
    case "plugin":
      return titled(payload.title);
  }
  return isExtension(payload) ? titled(payload.title) : newerInteraction(payload);
}

/** Extension kinds are namespaced `<owner>/<name>`; bb's own kinds carry no slash. */
function isExtension(payload: InteractionPayload): payload is ExtensionPayload {
  return payload.kind.includes("/");
}

const WAITING_FOR_INPUT = "The agent is waiting for input.";

function titled(title: string): string {
  return title.trim() || WAITING_FOR_INPUT;
}

/** A payload kind from a newer bb than this SDK: the compiler flags new kinds here, the runtime stays neutral. */
function newerInteraction(_payload: never): string {
  return WAITING_FOR_INPUT;
}

type ApprovalSubject = Extract<PendingInteraction["payload"], { kind: "approval" }>["subject"];

function describeApproval(subject: ApprovalSubject): string {
  switch (subject.kind) {
    case "command":
      return `Approve command: ${subject.command}`;
    case "file_change":
      return "Approve file changes.";
    case "permission_grant":
      return subject.toolName ? `Grant permissions to ${subject.toolName}.` : "Grant permissions.";
    case "plan":
      return "Review the plan before the agent continues.";
    case "tool_use":
      return `Approve ${subject.presentation.title ?? subject.tool}.`;
    default:
      return newerApproval(subject);
  }
}

/** A subject kind from a newer bb than this SDK: the compiler flags new kinds here, the runtime stays neutral. */
function newerApproval(_subject: never): string {
  return "The agent is waiting for an approval.";
}

/** One line, at most two sentences and 280 characters. */
function summarize(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const lead = line.split(/(?<=[.!?])\s/).slice(0, SUMMARY_MAX_SENTENCES).join(" ");
  return lead.length <= SUMMARY_MAX_CHARS ? lead : `${lead.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}
