// The verify step: the plugin, not the coordinating thread, starts a verifier for every done
// handoff while verification is on, and the handoff reaches the coordinating thread only with its
// verdict. A returned verdict is stored first, then settled: one that passed every criterion waits
// while CI on its commit is still to come, a crew's first failed verdict goes back to the crew, as
// the verifier's message, with no turn of the coordinating thread, and any other goes to the
// coordinating thread. Every change to a verdict is a compare-and-set in the store, so
// the crew tool, the verifier's crew_verdict and the tick can race without a verdict moving twice.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Crew } from "../../model/crew.ts";
import { handoffIsCurrent, type Handoff, type HandoffId, type NewHandoff } from "../../model/handoff.ts";
import { ciOf, type CiVerdict } from "../../model/verdict/pr.ts";
import { isSettled, judge, type CriterionResult, type ModelRef, type Verdict } from "../../model/verdict/verdict.ts";
import { isOpen, listedThreads } from "../crew/board.ts";
import { latestTurnSeq, type TurnsBb } from "../crew/handoffs.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Spawner, VerifierExecution, VerifierRequest } from "../spawn.ts";
import type { Settlement, Store } from "../store.ts";
import { findingsMessage } from "./findings.ts";
import { refusalOf } from "./send-refusal.ts";
import { sameModel, verifierExecution, type ModelsBb } from "./verifier-model.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type ThreadRow = Awaited<ReturnType<Threads["list"]>>[number];

/** A thread as the verify step lists it. */
type ListedThread = Pick<ThreadRow, "id" | "providerId" | "environmentId" | "status" | "archivedAt" | "deletedAt">;

/** The parts of bb the verify step uses, down to the fields it reads. */
type VerifyBb = ModelsBb & TurnsBb & {
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
  store: Pick<Store, "handoff" | "crew" | "coordinator" | "openVerdicts" | "markNudged" | "receiveVerdict" | "claimFixRound" | "unsettledVerdicts" | "prStatus">;
  spawner: Pick<Spawner, "verifier">;
  inbox: Pick<Inbox, "handoff" | "giveUpVerdict" | "settleVerdict">;
};

/** A verifier's report, each criterion named by its text. */
export type VerifierReport = Pick<Extract<Verdict, { state: "returned" }>, "headSha" | "findings"> & { criteria: { criterion: string; result: CriterionResult; evidence: string }[] };

type Running = Extract<Verdict, { state: "running" }>;
type Returned = Extract<Verdict, { state: "returned" }>;
type Done = Extract<Handoff, { status: "done" }>;

/** What settling a returned verdict does next: send its findings to the crew, wait for CI, or settle it as it is. */
type Step = { kind: "send"; ci: CiVerdict } | Exclude<Settlement, { kind: "sent-back" }>;

/** What a verdict that settles before CI finished on its commit says of CI: it failed on its criteria first. */
const CI_UNFINISHED: CiVerdict = { kind: "not-checked", reason: "CI hadn't finished when its criteria failed" };

/** How many failed verdicts go back to a crew before the next one goes to its coordinating thread. */
const MAX_AUTO_FIX_ROUNDS = 1;

const NUDGE =
  "You ended your turn without calling crew_verdict, so nobody has your verdict. Finish checking each done-criterion and call crew_verdict once; it is the only way your verdict reaches anyone.";

export type Verify = ReturnType<typeof createVerify>;

export function createVerify({ bb, store, spawner, inbox }: Deps) {
  // why: the crew tool and the tick can both find a verdict queued; one spawn is enough.
  const starting = new Set<HandoffId>();
  // why: crew_verdict and the tick can both settle a verdict, and its findings must reach the crew once.
  const settling = new Set<HandoffId>();
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
      inbox.giveUpVerdict(handoffId, { state: "queued" }, { state: "could-not-run", verifierThreadId: null, reason: `bb did not start a verifier: ${messageOf(error)}` });
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
    const giveUp = (reason: string) => inbox.giveUpVerdict(handoffId, from, { state: "could-not-run", verifierThreadId: verdict.verifierThreadId, reason });
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

  /** The handoff, its crew and its crew's thread, while a verifier's verdict on it is not settled; else null. */
  function unsettledOf(handoffId: HandoffId): { handoff: Done; crew: Crew; verdict: Returned; crewThreadId: string } | null {
    const handoff = store.handoff(handoffId);
    if (handoff?.status !== "done" || handoff.verdict.state !== "returned" || isSettled(handoff.verdict)) return null;
    const crew = store.crew(handoff.coordinatorId, handoff.crewId);
    // why throw: a verifier is started for a done handoff of a started crew.
    if (crew?.launch.kind !== "started") throw new Error(`The crew ${handoff.crewId} of ${handoff.coordinatorId} has no thread.`);
    return { handoff, crew, verdict: handoff.verdict, crewThreadId: crew.launch.threadId };
  }

  /**
   * The next step for an unsettled verdict (`latestTurnSeq`: its crew thread's, as bb lists it),
   * judged with CI on its commit as the crew's PR status says. One that passed every criterion
   * waits while CI is still to come. A failed one is sent back when its handoff is current and the
   * crew is open with a round left; else it is checked. One whose round is claimed was being sent when the plugin
   * stopped, as settle owns a claim until it settles it. Its findings may or may not have reached
   * the crew, and nothing bb keeps can tell: a send's pluginSubmission is never stored, and a turn
   * in the crew's thread may be anyone's. So it goes to the coordinating thread, with the round
   * kept, and is never sent again.
   */
  function stepOf(handoff: Done, crew: Crew, verdict: Returned, latestTurnSeq: number | null): Step {
    if (verdict.settlement.kind === "sending-back") return { kind: "maybe-sent-back" };
    const ci = ciOf(handoff, store.prStatus(crew.coordinatorId, crew.id));
    const judged = judge(verdict, ci);
    if (judged === "waiting-for-ci") return { kind: "waiting-for-ci" };
    const settledCi = ci.kind === "waiting" ? CI_UNFINISHED : ci;
    const send = judged === "fail" && handoffIsCurrent(handoff, latestTurnSeq) && isOpen(crew) && crew.fixRounds < MAX_AUTO_FIX_ROUNDS;
    return send ? { kind: "send", ci: settledCi } : { kind: "checked", refused: null, ci: settledCi };
  }

  /**
   * Settles a returned verdict: a failed one's findings go back to its crew while it has a round
   * left, anything else goes to the coordinating thread as checked. Its row says Verifying until
   * then. Safe to run again at any point, as the tick does after a crash or a reload: the round is
   * claimed in the store before the findings leave, and each step moves the verdict on only from
   * where it was. A claim a crash or reload left behind goes to the coordinating thread, which is
   * told the findings may or may not have reached the crew (see stepOf). The round comes back only
   * when bb refused the findings (see sendBack).
   */
  async function settle(handoffId: HandoffId): Promise<void> {
    if (disposed || settling.has(handoffId)) return;
    settling.add(handoffId);
    try {
      const crewThreadId = unsettledOf(handoffId)?.crewThreadId;
      if (crewThreadId === undefined) return;
      // why read bb first and the store right after, with no await before deciding: a turn the
      // crew starts after this read starts after the decision too.
      const latest = await latestTurnSeq(bb, crewThreadId);
      const unsettled = unsettledOf(handoffId);
      if (unsettled === null || disposed) return;
      const { handoff, crew, verdict } = unsettled;
      const step = stepOf(handoff, crew, verdict, latest);
      if (step.kind !== "send") return inbox.settleVerdict(handoffId, step);
      store.claimFixRound(handoffId, step.ci);
      // why settle whatever happened meanwhile: the claim, not the verdict's old state, says the findings are owed.
      inbox.settleVerdict(handoffId, await sendBack(handoff, crewThreadId, verdict, step.ci));
    } finally {
      settling.delete(handoffId);
    }
  }

  /**
   * Sends a failed verdict's findings to the crew's thread as its verifier's message, so bb marks
   * them as another thread's, never the user's; says how the verdict settles. Taken: sent back.
   * Refused, as only some of bb's answers prove: checked, with bb's answer. Any other failure may
   * come after bb took them, so they may or may not have reached the crew.
   */
  async function sendBack(handoff: Handoff, crewThreadId: string, verdict: Returned, ci: CiVerdict): Promise<Settlement> {
    try {
      await bb.sdk.threads.send({
        threadId: crewThreadId,
        senderThreadId: verdict.verifierThreadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: findingsMessage(verdict, ci), mentions: [] }],
      });
      return { kind: "sent-back" };
    } catch (error) {
      bb.log.warn(`Could not send the verifier's findings to ${handoff.crewId} (${crewThreadId}), so its coordinating thread decides: ${messageOf(error)}`);
      const refused = refusalOf(error);
      return refused === null ? { kind: "maybe-sent-back" } : { kind: "checked", refused, ci };
    }
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
     * Stores a verifier's verdict on the handoff it checks, with the models bb ran it and the crew
     * on, if it is still that handoff's running verifier, then settles it; says whether it was.
     */
    async returned(handoffId: HandoffId, verifierThreadId: string, crewThreadId: string, report: VerifierReport): Promise<boolean> {
      const [model, worker] = await Promise.all([modelOf(verifierThreadId), modelOf(crewThreadId)]);
      if (!store.receiveVerdict(handoffId, { state: "returned", verifierThreadId, ...report, model, sameModel: sameModel(model, worker) })) return false;
      // why not fail the verdict: it is stored, and the tick settles it.
      await settle(handoffId).catch((error: unknown) => bb.log.warn(`Could not settle the verdict on ${handoffId} yet; the next tick tries again: ${messageOf(error)}`));
      return true;
    },

    /**
     * The tick's pass, after the PR watch's reads: starts every verifier still queued, follows every
     * one still running, and settles every verdict that waits for CI or that a crash or a reload
     * left unsettled. why one read per verdict, right before acting on it: the pass awaits bb
     * between them.
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
      for (const handoffId of store.unsettledVerdicts()) {
        if (disposed) return;
        await settle(handoffId);
      }
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
