// What a coordinating thread does to its crews: start one, message one, read one, close one. Each
// action reads the crew from the plugin's database and its thread from bb, and ends by refreshing
// the board.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import type { ClosedKind, Crew } from "../../model/crew.ts";
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

/** One crew whole, with its row on the board and its thread's latest answer (null: none yet). */
export type CrewDetail = { crew: Crew; state: ReturnType<typeof crewState>; branch: string | null; output: string | null };

type Deps = {
  bb: CrewsBb;
  store: Pick<Store, "coordinator" | "crew" | "closeCrew">;
  spawner: Pick<Spawner, "crew">;
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

  function record(crew: Crew, as: ClosedKind): CloseOutcome {
    store.closeCrew(crew.coordinatorId, crew.id, as, Date.now());
    return { kind: "closed", as };
  }

  return {
    async start(id: CoordinatorId, request: CrewRequest): Promise<CrewLaunch> {
      try {
        return await spawner.crew(coordinatorOf(id), request);
      } finally {
        onChange(id);
      }
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
