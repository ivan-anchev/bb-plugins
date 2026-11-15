// bb's thread events about crews, turned into inbox events. They stand in for the report to the
// parent that crews spawn without: a turn that ended with no handoff, a failure, a question for the
// user. An archived crew thread closes its crew. Each handler skips threads another plugin made
// before it touches SQLite.
import type { PluginLogger, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import type { Crew } from "../../model/crew.ts";
import { isOpen } from "../crew/board.ts";
import { currentHandoff, type TurnsBb } from "../crew/handoffs.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Store } from "../store.ts";
import type { Inbox } from "./inbox.ts";

type ThreadRef = { id: string; originPluginId: string | null };
type Payload = PluginThreadEventPayloads["interaction.pending"]["interaction"]["payload"];
type Interaction = { payload: Payload };

/** The parts of bb the watch uses, down to the fields it reads. */
type WatchBb = TurnsBb & {
  pluginId: string;
  log: Pick<PluginLogger, "warn">;
  events: {
    on(event: "thread.idle", handler: (payload: { thread: ThreadRef; lastAssistantText: string | null }) => void | Promise<void>): void;
    on(event: "thread.failed", handler: (payload: { thread: ThreadRef; error: string | null }) => void): void;
    on(event: "interaction.pending", handler: (payload: { thread: ThreadRef; interaction: Interaction }) => void): void;
    on(event: "thread.archived", handler: (payload: { thread: ThreadRef }) => void): void;
  };
};

type Deps = {
  bb: WatchBb;
  store: Pick<Store, "roleOfThread" | "crew" | "latestHandoff" | "closeCrew">;
  inbox: Pick<Inbox, "record">;
  /** Runs after a crew is closed, to refresh its coordinating thread's board. */
  onChange(id: CoordinatorId): void;
};

export function watchCrewThreads({ bb, store, inbox, onChange }: Deps): void {
  /** The open crew whose thread this is, or null for any other thread. */
  function openCrewOf(thread: ThreadRef): (Crew & { launch: { kind: "started" } }) | null {
    if (thread.originPluginId !== bb.pluginId) return null;
    const role = store.roleOfThread(thread.id);
    if (role?.kind !== "crew") return null;
    const crew = store.crew(role.coordinatorId, role.crewId);
    return crew !== null && isOpen(crew) ? crew : null;
  }

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    const crew = openCrewOf(thread);
    if (crew === null) return;
    try {
      if ((await currentHandoff(bb, store, crew)) !== null) return;
    } catch (error) {
      // why not record: without the thread's turns the plugin can't tell an ended report from a missing one. The board still shows which.
      bb.log.warn(`Could not read the turns of ${crew.id} (${thread.id}), so its idle is not reported: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    inbox.record(crew.coordinatorId, { kind: "idle-without-handoff", crewId: crew.id, lastAnswer: lastAssistantText });
  });

  bb.events.on("thread.failed", ({ thread, error }) => {
    const crew = openCrewOf(thread);
    if (crew !== null) inbox.record(crew.coordinatorId, { kind: "failed", crewId: crew.id, error });
  });

  bb.events.on("interaction.pending", ({ thread, interaction }) => {
    const crew = openCrewOf(thread);
    // why tell the coordinating thread: only the user can answer a crew's question or approval, and it says so in its digest.
    if (crew !== null) inbox.record(crew.coordinatorId, { kind: "needs-input", crewId: crew.id, question: questionOf(interaction) });
  });

  bb.events.on("thread.archived", ({ thread }) => {
    const crew = openCrewOf(thread);
    if (crew === null) return;
    store.closeCrew(crew.coordinatorId, crew.id, "archived", Date.now());
    onChange(crew.coordinatorId);
  });
}

/** What a pending interaction asks of the user, in a line or a few. */
function questionOf({ payload }: Interaction): string {
  switch (payload.kind) {
    case "user_question":
      return payload.questions.map((question) => question.prompt).join("\n");
    case "approval":
      return `Asks to approve ${subjectOf(payload.subject)}${payload.reason === null ? "" : `: ${payload.reason}`}`;
    case "plugin":
      return payload.title;
    default:
      if (isNamespaced(payload)) return payload.title;
      // why not throw: bb can send an interaction newer than this plugin's SDK, and its fields are unknown.
      payload satisfies never;
      return "Asks the user something in its thread";
  }
}

/** A provider's own interaction, named `<provider>/<kind>`, titled as a plugin's is. */
const isNamespaced = (payload: Payload): payload is Extract<Payload, { kind: `${string}/${string}` }> => payload.kind.includes("/");

function subjectOf(subject: Extract<Payload, { kind: "approval" }>["subject"]): string {
  switch (subject.kind) {
    case "command":
      return `the command \`${subject.command}\``;
    case "file_change":
      return "a file change";
    case "permission_grant":
      return "a permission grant";
    case "plan":
      return "its plan";
    case "tool_use":
      return "a tool call";
    default:
      // why not throw: bb can send an approval newer than this plugin's SDK.
      subject satisfies never;
      return "an action";
  }
}
