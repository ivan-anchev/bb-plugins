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
  deliver: Deliver;
  failures: FailureLog;
  log: PluginLogger;
  /** Aborts when the plugin instance unloads; stops an in-flight POST. */
  signal: AbortSignal;
}

type Payload<E extends keyof PluginThreadEventPayloads> = PluginThreadEventPayloads[E];

/** The states of one thread that already woke its bot. */
interface SeenStates {
  interactions: Set<string>;
  /** The newest thread version that sent `finished` or `failed`. */
  settledVersion: number;
}

/**
 * Turns bb's thread signals into at most one POST per state change, to the
 * thread's routed target. A failed POST lands in the failure log.
 */
export function createWaker(deps: WakerDeps) {
  const seen = new Map<string, SeenStates>();

  return {
    onInteractionPending({ thread, interaction }: Payload<"interaction.pending">) {
      return wake(thread, async () => ({ kind: "interaction", interaction }));
    },
    onThreadIdle({ thread, lastAssistantText }: Payload<"thread.idle">) {
      return wake(thread, () => idleAttention(thread.id, lastAssistantText));
    },
    onThreadFailed({ thread, error }: Payload<"thread.failed">) {
      return wake(thread, async () => ({ kind: "failed", error }));
    },
  };

  async function wake(thread: ThreadResponse, attentionNow: () => Promise<Attention>) {
    if (!wakesBots(thread)) return;
    const target = routeFor(await deps.routes(), thread);
    if (target === null) return;
    const attention = await attentionNow();
    if (!claim(thread, attention)) return;
    await send(target, thread, attention);
  }

  /** A thread that idles on an open question or approval is waiting on that, not finished. */
  async function idleAttention(threadId: string, lastAssistantText: string | null): Promise<Attention> {
    const interaction = await deps.pendingInteraction(threadId);
    return interaction === null ? { kind: "finished", lastAssistantText } : { kind: "interaction", interaction };
  }

  /**
   * One POST per state, claimed before sending so overlapping or delayed
   * repeats of a signal find it taken. An interaction is its id. A finished or
   * failed thread is the row version bb moved into that status: a version at or
   * below the newest one already claimed is a repeat or a superseded state,
   * while a later idle → active → idle carries a newer version.
   */
  function claim(thread: ThreadResponse, attention: Attention): boolean {
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
