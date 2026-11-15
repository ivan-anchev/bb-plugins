// The only writer of events, and the only thing that wakes a coordinating thread. Each event is
// stored first, then announced by a doorbell: one short message that lists what happened, while the
// whole of it waits for crew_catch_up. Ringing derives everything from the database, so ringing
// again (on every tick, after a reload) sends only what no doorbell has announced yet.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { titlesOf } from "../../model/crew.ts";
import type { HandoffId, NewHandoff } from "../../model/handoff.ts";
import type { InboxEvent, StoredEvent } from "../../model/inbox/inbox-event.ts";
import { doorbellText } from "../../model/inbox/wake-text.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { Verdict } from "../../model/verdict.ts";
import type { Store, VerdictFrom } from "../store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SendArgs = Parameters<Threads["send"]>[0];

/** A message bb holds in a thread's queue, down to the fields the tick reads. */
type QueuedMessage = Pick<Awaited<ReturnType<Threads["queuedMessages"]["list"]>>[number], "id" | "state" | "failureReason">;

/** The parts of bb the inbox uses, down to the fields it reads. */
type InboxBb = {
  log: Pick<PluginLogger, "warn">;
  onDispose(hook: () => void): void;
  events: { on(event: "message.dispatched" | "message.cancelled", handler: (payload: { entry: { id: string } }) => void): void };
  sdk: {
    threads: {
      send(args: SendArgs): Promise<{ delivery: "sent" } | { delivery: "queued"; queuedMessage: { id: string } }>;
      queuedMessages: {
        list(args: { threadId: string }): Promise<QueuedMessage[]>;
        delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
      };
    };
  };
};

type InboxStore = Pick<
  Store,
  | "coordinator"
  | "crews"
  | "handoff"
  | "insertHandoff"
  | "settleVerdict"
  | "setVerify"
  | "insertEvent"
  | "unannounced"
  | "coordinatorsToRing"
  | "announce"
  | "takeUnread"
  | "doorbell"
  | "doorbells"
  | "clearDoorbell"
  | "reopenDoorbell"
>;

type Doorbell = ReturnType<Store["doorbells"]>[number];

type Deps = {
  bb: InboxBb;
  store: InboxStore;
  /** Runs after every event, to refresh the coordinating thread's board. */
  onChange(id: CoordinatorId): void;
};

export type Inbox = ReturnType<typeof createInbox>;

export function createInbox({ bb, store, onChange }: Deps) {
  // why: two events at once must not race two sends, and a send in flight must finish before the next.
  const ringing = new Set<CoordinatorId>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /** Sends one doorbell for every unannounced event, unless one is in flight or still queued in bb. */
  async function ring(id: CoordinatorId): Promise<void> {
    if (disposed || ringing.has(id) || store.doorbell(id) !== null) return;
    const coordinator = store.coordinator(id);
    const events = store.unannounced(id);
    // why: a coordinating thread whose thread isn't bound yet is rung by the tick once it is.
    if (coordinator === null || events.length === 0) return;
    ringing.add(id);
    let delivery: "sent" | "queued";
    try {
      const sent = await bb.sdk.threads.send({ threadId: coordinator.threadId, input: [{ type: "text", text: doorbellText(events, { titles: titlesOf(store.crews(id)), handoff: store.handoff }), mentions: [] }], mode: "queue-if-active" });
      // why record a send that lands after a dispose: it happened, and announcing it again would ring twice.
      store.announce(id, events.map((event) => event.id), sent.delivery === "queued" ? sent.queuedMessage.id : null, Date.now());
      delivery = sent.delivery;
    } catch (error) {
      bb.log.warn(`Could not wake the coordinating thread ${coordinator.threadId}; the next tick tries again: ${messageOf(error)}`);
      return;
    } finally {
      ringing.delete(id);
    }
    // why ring again: events recorded while the send was in flight weren't in it. A queued doorbell
    // holds them until it dispatches.
    if (delivery === "sent") await ring(id);
  }

  /** Rings without waiting; anything that goes wrong is logged, and the tick rings again. */
  function ringSoon(id: CoordinatorId): void {
    ring(id).catch((error: unknown) => bb.log.warn(`Could not ring ${id}: ${messageOf(error)}`));
  }

  /**
   * Takes back a doorbell still waiting in bb's queue: called once every event is read, it would
   * wake the thread for nothing. If bb sent it meanwhile, the delete fails and nothing changes.
   */
  async function withdraw(id: CoordinatorId): Promise<void> {
    const queuedMessageId = store.doorbell(id);
    const coordinator = store.coordinator(id);
    if (disposed || queuedMessageId === null || coordinator === null) return;
    try {
      await bb.sdk.threads.queuedMessages.delete({ threadId: coordinator.threadId, queuedMessageId });
    } catch (error) {
      bb.log.warn(`Could not take back the queued doorbell ${queuedMessageId}; it may have been sent already: ${messageOf(error)}`);
      return;
    }
    // why ring: an event recorded since the catch-up was held back by the doorbell just taken back.
    if (store.clearDoorbell(queuedMessageId) !== null) await ring(id);
  }

  /**
   * Checks a queued doorbell against bb's queue. One bb no longer has was sent or dropped while the
   * plugin wasn't listening, so it is forgotten. One bb gave up on never reached the thread and
   * would hold every later doorbell back, so it is forgotten, what it announced is announced again,
   * and it is taken out of bb's queue.
   */
  async function check(doorbell: Doorbell): Promise<void> {
    const queue = await queueOf(doorbell);
    if (queue === null) return;
    const queued = queue.find((message) => message.id === doorbell.queuedMessageId);
    if (queued === undefined) store.clearDoorbell(doorbell.queuedMessageId);
    // why only exhausted: one bb still retries may yet be sent.
    else if (queued.state === "failed_exhausted") await giveUp(doorbell, queued.failureReason);
  }

  /** The thread's queue, or null when bb can't be read: a failed read is not proof that the doorbell is gone. */
  async function queueOf({ coordinatorId, threadId }: Doorbell): Promise<QueuedMessage[] | null> {
    try {
      return await bb.sdk.threads.queuedMessages.list({ threadId });
    } catch (error) {
      bb.log.warn(`Could not read the queue of ${threadId} (${coordinatorId}); its doorbell stays: ${messageOf(error)}`);
      return null;
    }
  }

  async function giveUp({ coordinatorId, threadId, queuedMessageId }: Doorbell, failureReason: string | null): Promise<void> {
    bb.log.warn(`bb gave up sending the doorbell ${queuedMessageId} to ${threadId} (${coordinatorId}), so it rings again: ${failureReason ?? "no reason given"}`);
    // why reopen first: bb answers the delete with message.cancelled, whose handler clears the doorbell
    // and rings; that ring must already include what this doorbell announced.
    store.reopenDoorbell(queuedMessageId);
    try {
      await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId });
    } catch (error) {
      bb.log.warn(`Could not take the failed doorbell ${queuedMessageId} out of the queue of ${threadId}; it stays there, failed: ${messageOf(error)}`);
    }
  }

  function recorded(id: CoordinatorId): void {
    onChange(id);
    ringSoon(id);
  }

  // why: the doorbell's text was fixed when it was sent; whatever arrived while it sat queued gets the next one.
  const settle = ({ entry }: { entry: { id: string } }) => {
    const id = store.clearDoorbell(entry.id);
    if (id !== null) ringSoon(id);
  };
  bb.events.on("message.dispatched", settle);
  bb.events.on("message.cancelled", settle);

  return {
    /**
     * Stores the handoff with its verdict, and its event unless a verifier is still to check it, then
     * wakes its coordinating thread. Returns what the store did (see insertHandoff).
     */
    handoff(handoff: NewHandoff): ReturnType<Store["insertHandoff"]> {
      const inserted = store.insertHandoff(handoff);
      recorded(handoff.coordinatorId);
      return inserted;
    },

    /** Settles a waiting verdict and announces its handoff, if it is still where `from` says; says whether it was. */
    settle(handoffId: HandoffId, from: VerdictFrom, verdict: Extract<Verdict, { state: "returned" | "could-not-run" }>): boolean {
      const id = store.settleVerdict(handoffId, from, verdict, Date.now());
      if (id !== null) recorded(id);
      return id !== null;
    },

    /** The user's switch: turns verification on or off, and tells the coordinating thread when it changed. */
    setVerify(id: CoordinatorId, verify: boolean): void {
      if (store.setVerify(id, verify, Date.now())) recorded(id);
    },

    /** Stores the event, then wakes its coordinating thread. A crash between the two is rung by the next tick. */
    record(id: CoordinatorId, event: InboxEvent): void {
      store.insertEvent(id, event, Date.now());
      recorded(id);
    },

    /** Every unread event, whole, marked read as it is returned. A doorbell still queued then announces nothing unread, so it is taken back. */
    takeUnread(id: CoordinatorId): StoredEvent[] {
      const events = store.takeUnread(id, Date.now());
      withdraw(id).catch((error: unknown) => bb.log.warn(`Could not take back the doorbell of ${id}: ${messageOf(error)}`));
      return events;
    },

    /**
     * The once-a-minute pass. It forgets a queued doorbell bb no longer has, because its
     * `message.dispatched` can be missed while the plugin reloads, and one bb gave up sending, then
     * rings every coordinating thread with an event left unannounced (a failed send, a crash after
     * a write, a doorbell bb gave up on).
     */
    async tick(): Promise<void> {
      for (const doorbell of store.doorbells()) {
        if (disposed) return;
        await check(doorbell);
      }
      await Promise.all(store.coordinatorsToRing().map(ring));
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
