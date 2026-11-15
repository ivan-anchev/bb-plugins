// The verify step: the plugin, not the coordinating thread, starts a verifier for every done
// handoff while verification is on, and the handoff reaches the coordinating thread only with its
// verdict. Every change to a verdict is a compare-and-set in the store, so the crew tool, the
// verifier's crew_verdict and the tick can race without a verdict moving twice.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { HandoffId, NewHandoff } from "../../model/handoff.ts";
import type { CriterionResult, ModelRef, Verdict } from "../../model/verdict.ts";
import { listedThreads } from "../crew/board.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Spawner, VerifierExecution, VerifierRequest } from "../spawn.ts";
import type { Store } from "../store.ts";
import { sameModel, verifierExecution, type ModelsBb } from "./verifier-model.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type ThreadRow = Awaited<ReturnType<Threads["list"]>>[number];

/** A thread as the verify step lists it. */
type ListedThread = Pick<ThreadRow, "id" | "providerId" | "environmentId" | "status" | "archivedAt" | "deletedAt">;

/** The parts of bb the verify step uses, down to the fields it reads. */
type VerifyBb = ModelsBb & {
  log: Pick<PluginLogger, "warn">;
  onDispose(hook: () => void): void;
  sdk: {
    threads: {
      list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]>;
      defaultExecutionOptions(args: { threadId: string }): Promise<{ model: string; reasoningLevel: string } | null>;
      send(args: Parameters<Threads["send"]>[0]): Promise<unknown>;
      stop(args: { threadId: string }): Promise<unknown>;
    };
  };
};

type Deps = {
  bb: VerifyBb;
  store: Pick<Store, "handoff" | "crew" | "coordinator" | "openVerdicts" | "markNudged">;
  spawner: Pick<Spawner, "verifier">;
  inbox: Pick<Inbox, "handoff" | "settle">;
};

/** A verifier's report, each criterion named by its text. */
export type VerifierReport = Pick<Extract<Verdict, { state: "returned" }>, "headSha" | "findings"> & { criteria: { criterion: string; result: CriterionResult; evidence: string }[] };

type Running = Extract<Verdict, { state: "running" }>;


const NUDGE =
  "You ended your turn without calling crew_verdict, so nobody has your verdict. Finish checking each done-criterion and call crew_verdict once; it is the only way your verdict reaches anyone.";

export type Verify = ReturnType<typeof createVerify>;

export function createVerify({ bb, store, spawner, inbox }: Deps) {
  // why: the crew tool and the tick can both find a verdict queued; one spawn is enough.
  const starting = new Set<HandoffId>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /** The provider, model and reasoning level of the thread's latest turn, or null before its first. */
  async function executionOf(thread: ListedThread): Promise<VerifierExecution | null> {
    const options = await bb.sdk.threads.defaultExecutionOptions({ threadId: thread.id });
    return options === null ? null : { providerId: thread.providerId, model: options.model, reasoningLevel: options.reasoningLevel };
  }

  /** Everything a verifier for this handoff needs, or null once its verdict is no longer queued. */
  async function requestFor(handoffId: HandoffId): Promise<VerifierRequest | null> {
    const handoff = store.handoff(handoffId);
    if (handoff?.status !== "done" || handoff.verdict.state !== "queued") return null;
    const crew = store.crew(handoff.coordinatorId, handoff.crewId);
    const coordinator = store.coordinator(handoff.coordinatorId);
    // why throw: a crew hands off from its bound thread, which its coordinating thread started.
    if (crew?.launch.kind !== "started" || coordinator === null) throw new Error(`The crew ${handoff.crewId} of ${handoff.coordinatorId} has no thread.`);
    const crewThreadId = crew.launch.threadId;
    const threads = await listedThreads(bb, [crewThreadId, coordinator.threadId]);
    const crewThread = threads.get(crewThreadId);
    if (crewThread === undefined) throw new Error("the crew's thread was archived or deleted");
    if (crewThread.environmentId === null) throw new Error("the crew's thread has no environment to check");
    const worker = await executionOf(crewThread);
    if (worker === null) throw new Error("bb has no model on record for the crew's thread");
    const coordinatorThread = threads.get(coordinator.threadId);
    const execution = await verifierExecution(bb, {
      worker,
      coordinator: coordinatorThread === undefined ? null : await executionOf(coordinatorThread),
      environmentId: crewThread.environmentId,
    });
    return { coordinator, crew: { ...crew, launch: crew.launch }, handoff, environmentId: crewThread.environmentId, execution };
  }

  /** Starts the handoff's verifier if its verdict is still queued; one that can't start is recorded as could-not-run. */
  async function start(handoffId: HandoffId): Promise<void> {
    if (disposed || starting.has(handoffId)) return;
    starting.add(handoffId);
    try {
      const request = await requestFor(handoffId);
      if (request === null || disposed) return;
      await spawner.verifier(request);
    } catch (error) {
      // why only from queued: bb may have made the thread and bound it through thread.created, with only its answer lost.
      inbox.settle(handoffId, { state: "queued" }, { state: "could-not-run", verifierThreadId: null, reason: `bb did not start a verifier: ${messageOf(error)}` });
    } finally {
      starting.delete(handoffId);
    }
  }

  async function stop(threadId: string): Promise<void> {
    try {
      await bb.sdk.threads.stop({ threadId });
    } catch (error) {
      bb.log.warn(`Could not stop the superseded verifier ${threadId}; its verdict will be refused: ${messageOf(error)}`);
    }
  }

  /** A running verdict on the tick: a verifier that is gone, or idle without a verdict, is nudged once, then given up on. */
  async function follow(handoffId: HandoffId, verdict: Running, thread: ListedThread | null): Promise<void> {
    const from = { state: "running", verifierThreadId: verdict.verifierThreadId } as const;
    const giveUp = (reason: string) => inbox.settle(handoffId, from, { state: "could-not-run", verifierThreadId: verdict.verifierThreadId, reason });
    if (thread === null) return void giveUp("its verifier thread was archived or deleted before it returned a verdict");
    if (thread.status !== "idle" && thread.status !== "error") return;
    if (verdict.nudged) return void giveUp("its verifier stopped without a verdict twice, the second time after a reminder");
    // why mark first: a nudge sent twice would double the verifier's work; a lost one only ends it sooner.
    if (!store.markNudged(handoffId, verdict.verifierThreadId)) return;
    try {
      await bb.sdk.threads.send({ threadId: thread.id, mode: "queue-if-active", input: [{ type: "text", text: NUDGE, mentions: [] }] });
    } catch (error) {
      bb.log.warn(`Could not remind the verifier ${thread.id} to return its verdict: ${messageOf(error)}`);
    }
  }

  /** The provider and model bb records for the thread's latest turn. why throw: both threads have run a turn by now. */
  async function modelOf(threadId: string): Promise<ModelRef> {
    const thread = (await listedThreads(bb, [threadId])).get(threadId);
    const execution = thread === undefined ? null : await executionOf(thread);
    if (execution === null) throw new Error(`bb has no model on record for ${threadId}.`);
    return { providerId: execution.providerId, model: execution.model };
  }

  return {
    /**
     * Stores a crew's handoff, stops the verifiers of the earlier done handoffs it supersedes, and
     * starts its own when verification is on. Returns its verdict (null: not done).
     */
    async handoff(handoff: NewHandoff): Promise<Verdict | null> {
      const { verdict, superseded } = inbox.handoff(handoff);
      await Promise.all(superseded.map(stop));
      if (verdict?.state === "queued") await start(handoff.id);
      return verdict;
    },

    /**
     * Records a verifier's verdict on the handoff it checks, with the models bb ran it and the crew
     * on, if it is still that handoff's running verifier; says whether it was.
     */
    async returned(handoffId: HandoffId, verifierThreadId: string, crewThreadId: string, report: VerifierReport): Promise<boolean> {
      const [model, worker] = await Promise.all([modelOf(verifierThreadId), modelOf(crewThreadId)]);
      return inbox.settle(handoffId, { state: "running", verifierThreadId }, { state: "returned", verifierThreadId, ...report, model, sameModel: sameModel(model, worker) });
    },

    /**
     * The tick's pass: starts every verifier still queued, and follows every one still running.
     * why one read per verifier, right before acting on it: the pass awaits bb between them.
     */
    async reconcile(): Promise<void> {
      for (const { handoffId, verdict } of store.openVerdicts()) {
        if (disposed) return;
        if (verdict.state === "queued") {
          await start(handoffId);
          continue;
        }
        const thread = (await listedThreads(bb, [verdict.verifierThreadId])).get(verdict.verifierThreadId) ?? null;
        if (!disposed) await follow(handoffId, verdict, thread);
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
