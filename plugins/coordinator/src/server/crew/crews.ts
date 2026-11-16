// What a coordinating thread and the user do to crews: start one or save it as a draft, edit and
// start a draft, message one, read one, close one, replace one with a fresh one. Each action reads the crew from the plugin's
// database and its thread from bb, and ends by refreshing the board.
import { experimental_PluginRpcRefusal as Refusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import type { Coordinator } from "../../contract.ts";
import { branchOf, type ClosedKind, type Crew, type DraftEdit } from "../../model/crew.ts";
import { crewState } from "../../model/board/crew-state.ts";
import { handoffIsCurrent, type Handoff } from "../../model/handoff.ts";
import { supersedingBrief } from "../verify/findings.ts";
import type { CoordinatorId, CrewId } from "../../model/role.ts";
import type { CrewLaunch, CrewRequest, Spawner } from "../spawn.ts";
import type { Store } from "../store.ts";
import { listedThreads, type BoardBb } from "./board/board.ts";
import { latestTurnSeq } from "./handoffs.ts";

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

/**
 * What a replacement did: the old crew is closed (`closedAs`: stopped now, or as it already was) and
 * the new one started, or nothing started because the old one's thread still runs.
 */
export type SupersedeOutcome = { kind: "replaced"; closedAs: ClosedKind; start: StartOutcome } | Extract<CloseOutcome, { kind: "still-running" }>;

/** What a replacement may change; anything left out is the old crew's. */
type Changes = Partial<Pick<Crew, "title" | "brief" | "doneCriteria" | "placement">> & { draft: boolean };

/**
 * One crew whole: its row on the board, its latest handoff (null: none) and whether it is current
 * (null: its thread is gone, so there are no turns to compare), and its thread's latest answer
 * (null: none yet).
 */
export type CrewDetail = {
  crew: Crew;
  state: ReturnType<typeof crewState>;
  branch: string | null;
  handoff: { handoff: Handoff; current: boolean | null } | null;
  output: string | null;
};

type Deps = {
  bb: CrewsBb;
  store: Pick<Store, "coordinator" | "crew" | "updateDraft" | "closeCrew" | "latestHandoff" | "latestReturnedVerdict" | "prStatus">;
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

  /**
   * Saves the crew, then spawns its thread unless it is a draft. why save first: a spawn that
   * fails or crashes leaves a draft the user can start.
   */
  function start(id: CoordinatorId, request: CrewRequest & { draft: boolean }): Promise<StartOutcome> {
    const coordinator = coordinatorOf(id);
    const { draft, ...crewRequest } = request;
    const crewId = spawner.saveCrew(coordinator, crewRequest);
    onChange(id);
    if (draft) return Promise.resolve({ crewId, kind: "drafted" });
    return launchOnce(id, crewId, () => spawner.launch(coordinator, draftOf(id, crewId)));
  }

  async function close(crew: Crew, action: CloseAction): Promise<CloseOutcome> {
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
  }

  return {
    start,

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
      const threadId = crew.launch.kind === "started" && thread !== null ? crew.launch.threadId : null;
      const output = threadId === null ? null : (await bb.sdk.threads.output({ threadId })).output;
      const handoff = store.latestHandoff(crew.coordinatorId, crew.id);
      const current = handoff === null || threadId === null ? null : handoffIsCurrent(handoff, await latestTurnSeq(bb, threadId));
      return {
        crew,
        state: crewState(crew, thread, current === true ? handoff : null, store.prStatus(crew.coordinatorId, crew.id)?.snapshot ?? null),
        branch: thread === null ? null : branchOf(crew, thread),
        handoff: handoff === null ? null : { handoff, current },
        output,
      };
    },

    close,

    /**
     * Replaces a crew with a fresh one: stops it and closes it as stopped, then starts a crew from
     * its title, brief, done-criteria, placement and model, each unless `changes` gives another, with
     * its latest verdict's findings after the brief. Starts nothing while its thread still runs.
     */
    async supersede(old: Crew, { draft, ...changes }: Changes): Promise<SupersedeOutcome> {
      const closed = await close(old, "stop");
      if (closed.kind === "still-running") return closed;
      // why read after the stop: a verifier of its work may have returned meanwhile.
      const verdict = store.latestReturnedVerdict(old.coordinatorId, old.id);
      const started = await start(old.coordinatorId, {
        title: changes.title ?? old.title,
        brief: supersedingBrief(old, changes.brief ?? old.brief, verdict),
        doneCriteria: changes.doneCriteria ?? old.doneCriteria,
        placement: changes.placement ?? old.placement,
        execution: old.execution,
        draft,
      });
      return { kind: "replaced", closedAs: closed.as, start: started };
    },
  };
}

const CLOSED_AS: Record<CloseAction, ClosedKind> = { stop: "stopped", resolve: "resolved", archive: "archived" };

/** Whether bb has the crew's thread, so it can be messaged. */
export const isStarted = (crew: Crew): crew is Crew & { launch: { kind: "started" } } => crew.launch.kind === "started";
