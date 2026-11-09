import type { PluginLogger, PluginThreadEventPayloads } from "@get-bb/plugin-sdk";
import type { PendingInteraction, ThreadResponse } from "./bb-types.ts";
import type { Deliver } from "./delivery.ts";
import type { FailureLog } from "./failure-log.ts";
import { routeFor, type Routes, type Target } from "./routes.ts";
import { wakeBody, type Attention } from "./wake-body.ts";

interface WakerDeps {
  /** The current routes, read fresh for every event. */
  routes(): Promise<Routes>;
  /** The thread's open interaction, if it has one now. */
  pendingInteraction(threadId: string): Promise<PendingInteraction | null>;
  /** Whether the thread's latest turn ended interrupted, as when a user stops it. */
  lastTurnInterrupted(threadId: string): Promise<boolean>;
  deliver: Deliver;
  failures: FailureLog;
  log: PluginLogger;
  /** Aborts when the plugin instance unloads; stops an in-flight POST. */
  signal: AbortSignal;
}

type Payload<E extends keyof PluginThreadEventPayloads> = PluginThreadEventPayloads[E];

/** A user stopped the turn: the idle state is settled, but nobody is woken. */
interface Stopped {
  kind: "stopped";
}

/** The states of one thread already settled, whether or not they woke its bot. */
interface SeenStates {
  interactions: Set<string>;
  /** The newest thread version that settled as finished, stopped, or failed. */
  settledVersion: number;
}

/**
 * Turns bb's thread signals into at most one POST per state change, to the
 * thread's routed target. A failed POST lands in the failure log. A handler
 * returns once its state is claimed; the POST runs on after it, so a slow
 * webhook never holds up bb. `idle()` waits for handlers and POSTs to settle.
 */
export function createWaker(deps: WakerDeps) {
  const seen = new Map<string, SeenStates>();
  /** Handler calls and the POSTs they started that have not settled yet. */
  const pending = new Set<Promise<void>>();

  return {
    onInteractionPending({ thread, interaction }: Payload<"interaction.pending">) {
      return track(wake(thread, async () => ({ kind: "interaction", interaction })));
    },
    onThreadIdle({ thread, lastAssistantText }: Payload<"thread.idle">) {
      return track(wake(thread, () => idleAttention(thread.id, lastAssistantText)));
    },
    onThreadFailed({ thread, error }: Payload<"thread.failed">) {
      return track(wake(thread, async () => ({ kind: "failed", error })));
    },
    /** Resolves once every handler and POST started so far has settled, delivered or logged. */
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };

  function track(work: Promise<void>): Promise<void> {
    pending.add(work);
    const settled = () => void pending.delete(work);
    void work.then(settled, settled);
    return work;
  }

  async function wake(thread: ThreadResponse, attentionNow: () => Promise<Attention | Stopped>) {
    if (!wakesBots(thread)) return;
    const target = routeFor(await deps.routes(), thread);
    if (target === null) return;
    const attention = await attentionNow();
    if (!claim(thread, attention)) return;
    if (attention.kind === "stopped") return;
    start(target, thread, attention);
  }

  /**
   * Starts the POST without awaiting it. `deps.signal` still cancels it when the
   * plugin unloads, and `send` never rejects, so nothing escapes unhandled.
   */
  function start(target: Target, thread: ThreadResponse, attention: Attention) {
    void track(
      send(target, thread, attention).catch((error: unknown) => {
        deps.log.error(`could not send ${attention.kind} on ${thread.id}: ${String(error)}`);
      }),
    );
  }

  /**
   * A thread that idles on an open question or approval is waiting on that,
   * and one a user stopped needs nothing; otherwise it finished.
   */
  async function idleAttention(threadId: string, lastAssistantText: string | null): Promise<Attention | Stopped> {
    const interaction = await deps.pendingInteraction(threadId);
    if (interaction !== null) return { kind: "interaction", interaction };
    if (await stoppedByUser(threadId)) return { kind: "stopped" };
    return { kind: "finished", lastAssistantText };
  }

  /** An unreadable turn ending counts as finished: a spare wake beats a lost completion. */
  async function stoppedByUser(threadId: string): Promise<boolean> {
    try {
      return await deps.lastTurnInterrupted(threadId);
    } catch (error) {
      deps.log.warn(`could not read how ${threadId}'s last turn ended, so it counts as finished: ${String(error)}`);
      return false;
    }
  }

  /**
   * One POST per state, claimed before sending so overlapping or delayed
   * repeats of a signal find it taken. An interaction is its id. A finished,
   * stopped, or failed thread is the row version bb moved into that status: a
   * version at or below the newest one already claimed is a repeat or a
   * superseded state, while a later idle → active → idle carries a newer
   * version. A stop claims its version without sending, so a late repeat of it
   * cannot send finished once a newer turn has completed.
   */
  function claim(thread: ThreadResponse, attention: Attention | Stopped): boolean {
    const states = seen.get(thread.id) ?? { interactions: new Set<string>(), settledVersion: -Infinity };
    seen.set(thread.id, states);
    if (attention.kind === "interaction") {
      if (states.interactions.has(attention.interaction.id)) return false;
      states.interactions.add(attention.interaction.id);
      return true;
    }
    if (thread.updatedAt <= states.settledVersion) return false;
    states.settledVersion = thread.updatedAt;
    return true;
  }

  async function send(target: Target, thread: ThreadResponse, attention: Attention) {
    const body = wakeBody(thread, attention);
    const result = await deps.deliver(target, body, deps.signal);
    const what = `${body.event} on ${thread.id} to ${target}`;
    if (result.ok) {
      deps.log.info(`sent ${what}: ${result.status}`);
      return;
    }
    deps.failures.record(target, body, result.reason);
    deps.log.warn(`could not send ${what}: ${result.reason}; kept in the failure log`);
  }
}

/** Only top-level threads you can see wake a bot. */
function wakesBots(thread: ThreadResponse): boolean {
  return thread.visibility === "visible" && thread.parentThreadId === null;
}
