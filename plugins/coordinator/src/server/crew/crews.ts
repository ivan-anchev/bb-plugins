// What a coordinating thread and the user do to crews: start one or save it as a draft, edit and
// start a draft, message one, read one, close one. Each action reads the crew from the plugin's
// database and its thread from bb, and ends by refreshing the board.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import type { ClosedKind, Crew, DraftEdit } from "../../model/crew.ts";
import { crewState } from "../../model/crew-state.ts";
import type { CoordinatorId, CrewId } from "../../model/role.ts";
import type { CrewLaunch, CrewRequest, Spawner } from "../spawn.ts";
import type { Store } from "../store.ts";
import { listedThreads, type BoardBb } from "./board.ts";

type Threads = BbPluginApi["sdk"]["threads"];

/** The parts of bb crew actions use, down to the fields they read. */
type CrewsBb = BoardBb & {
  sdk: {
    threads: {
      send(args: Parameters<Threads["send"]>[0]): Promise<{ delivery: "sent" | "queued" }>;
      stop(args: { threadId: string }): Promise<unknown>;
      archive(args: { threadId: string }): Promise<unknown>;
      output(args: { threadId: string }): Promise<{ output: string | null }>;
    };
  };
};

/** How crew_close asks to close a crew. */
type CloseAction = "stop" | "resolve" | "archive";

/** What a close did. A stop is recorded only once bb no longer runs the thread. */
export type CloseOutcome =
  | { kind: "closed"; as: ClosedKind }
  | { kind: "already-closed"; as: ClosedKind }
  | { kind: "still-running"; status: string };

/** What crew_start did: saved the crew as a draft, or spawned its thread. */
export type StartOutcome = CrewLaunch | { crewId: CrewId; kind: "drafted" };

/** One crew whole, with its row on the board and its thread's latest answer (null: none yet). */
export type CrewDetail = { crew: Crew; state: ReturnType<typeof crewState>; branch: string | null; output: string | null };

type Deps = {
  bb: CrewsBb;
  store: Pick<Store, "coordinator" | "crew" | "updateDraft" | "closeCrew">;
  spawner: Pick<Spawner, "saveCrew" | "launch">;
  /** Runs after anything that changes a coordinating thread's board. */
  onChange(id: CoordinatorId): void;
};

export type Crews = ReturnType<typeof createCrews>;

export function createCrews({ bb, store, spawner, onChange }: Deps) {
  function coordinatorOf(id: CoordinatorId): Coordinator {
    const coordinator = store.coordinator(id);
    // why throw: a tool resolves the caller's role from a bound thread, so its coordinator is bound.
    if (coordinator === null) throw new Error(`The coordinating thread ${id} has no thread.`);
    return coordinator;
  }

  async function threadOf(crew: Crew) {
    if (crew.launch.kind === "draft") return null;
    return (await listedThreads(bb, [crew.launch.threadId])).get(crew.launch.threadId) ?? null;
  }

  // A second Start while one is in flight for the same crew joins it, so a double click spawns one
  // thread. Once one lands the crew is no longer a draft, and a later Start is refused.
  const launching = new Map<string, Promise<CrewLaunch>>();
  const keyOf = (id: CoordinatorId, crewId: CrewId) => `${id}/${crewId}`;

  function launchOnce(id: CoordinatorId, crewId: CrewId, launch: () => Promise<CrewLaunch>): Promise<CrewLaunch> {
    const key = keyOf(id, crewId);
    const pending = launching.get(key);
    if (pending !== undefined) return pending;
    const started = launch().finally(() => {
      launching.delete(key);
      onChange(id);
    });
    launching.set(key, started);
    return started;
  }

  /** The crew, or a refusal naming why it is not a draft the user can change or start. */
  function draftOf(id: CoordinatorId, crewId: CrewId): Crew {
    const crew = store.crew(id, crewId);
    if (crew === null) throw new Refusal({ code: "not_found", message: `There is no crew ${crewId}.` });
    if (crew.closed !== null) throw new Refusal({ code: "conflict", message: `${crewId} is ${crew.closed.kind}, so it can't be started or edited.` });
    if (crew.launch.kind === "started") throw new Refusal({ code: "conflict", message: `${crewId} has already started, so it is no longer a draft.` });
    return crew;
  }

  function record(crew: Crew, as: ClosedKind): CloseOutcome {
    store.closeCrew(crew.coordinatorId, crew.id, as, Date.now());
    return { kind: "closed", as };
  }

  return {
    /**
     * Saves the crew, then spawns its thread unless it is a draft. why save first: a spawn that
     * fails or crashes leaves a draft the user can start.
     */
    start(id: CoordinatorId, request: CrewRequest & { draft: boolean }): Promise<StartOutcome> {
      const coordinator = coordinatorOf(id);
      const { draft, ...crewRequest } = request;
      const crewId = spawner.saveCrew(coordinator, crewRequest);
      onChange(id);
      if (draft) return Promise.resolve({ crewId, kind: "drafted" });
      return launchOnce(id, crewId, () => spawner.launch(coordinator, draftOf(id, crewId)));
    },

    /** The user's Start on a draft: spawns it from what is stored. */
    startDraft(id: CoordinatorId, crewId: CrewId): Promise<CrewLaunch> {
      return launchOnce(id, crewId, async () => spawner.launch(coordinatorOf(id), draftOf(id, crewId)));
    },

    /** The user's edit of a draft, refused once it is starting, started or closed. */
    updateDraft(id: CoordinatorId, crewId: CrewId, edit: DraftEdit): void {
      if (launching.has(keyOf(id, crewId))) throw new Refusal({ code: "conflict", message: `${crewId} is starting, so it can no longer be edited.` });
      draftOf(id, crewId);
      store.updateDraft(id, crewId, edit);
      onChange(id);
    },

    /** Sends the text as a message from the coordinating thread: it steers a running turn or starts one. */
    async message(crew: Crew & { launch: { kind: "started" } }, text: string): Promise<"sent" | "queued"> {
      const { delivery } = await bb.sdk.threads.send({
        threadId: crew.launch.threadId,
        senderThreadId: coordinatorOf(crew.coordinatorId).threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
      onChange(crew.coordinatorId);
      return delivery;
    },

    async detail(crew: Crew): Promise<CrewDetail> {
      const thread = await threadOf(crew);
      const output = crew.launch.kind === "started" && thread !== null ? (await bb.sdk.threads.output({ threadId: crew.launch.threadId })).output : null;
      return { crew, state: crewState(crew, thread), branch: thread?.environmentBranchName ?? null, output };
    },

    async close(crew: Crew, action: CloseAction): Promise<CloseOutcome> {
      if (crew.closed !== null) return { kind: "already-closed", as: crew.closed.kind };
      try {
        if (crew.launch.kind === "draft") return record(crew, CLOSED_AS[action]);
        const threadId = crew.launch.threadId;
        switch (action) {
          case "resolve":
            return record(crew, "resolved");
          case "archive":
            await bb.sdk.threads.archive({ threadId });
            return record(crew, "archived");
          case "stop": {
            await bb.sdk.threads.stop({ threadId });
            // why read again: bb's stop can leave the thread stopping, and a crew is recorded as
            // stopped only once its thread no longer runs.
            const thread = await threadOf(crew);
            if (thread !== null && thread.status !== "idle" && thread.status !== "error") return { kind: "still-running", status: thread.status };
            return record(crew, "stopped");
          }
          default:
            return action satisfies never;
        }
      } finally {
        onChange(crew.coordinatorId);
      }
    },
  };
}

const CLOSED_AS: Record<CloseAction, ClosedKind> = { stop: "stopped", resolve: "resolved", archive: "archived" };

/** Whether bb has the crew's thread, so it can be messaged. */
export const isStarted = (crew: Crew): crew is Crew & { launch: { kind: "started" } } => crew.launch.kind === "started";
