// The only writer of events, and the only thing that wakes a regional manager. Each event is
// stored first, then announced by a doorbell: one short message that lists what happened, while the
// whole of it waits for crew_catch_up. Ringing derives everything from the database, so ringing
// again (on every tick, after a reload) sends only what no doorbell has announced yet.
import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Agent, AgentId, EndedHow } from "../../model/agent/agent.ts";
import type { DecisionId } from "../../model/decision.ts";
import type { CommentId } from "../../model/feed/comment.ts";
import type { GivenHandoff, Handoff, HandoffId } from "../../model/agent/handoff.ts";
import { wakes, type InboxEvent, type StoredEvent } from "../../model/inbox/inbox-event.ts";
import { doorbellText } from "../../model/inbox/wake-text.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { CheckId } from "../../model/verdict/check.ts";
import type { CheckoutRead } from "../../model/verdict/checkout.ts";
import type { PrSnapshot, PrUnavailable } from "../../model/verdict/pr.ts";
import { isLive, threadsById } from "../agents/threads.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import { storeReport } from "../memory/report-file.ts";
import type { GivenUp, Settlement, VerdictFrom } from "../store/issue/checks-store.ts";
import type { NewComment } from "../store/feed/comments-store.ts";
import type { Store } from "../store/store.ts";

type Threads = BbPluginApi["sdk"]["threads"];
type SendArgs = Parameters<Threads["send"]>[0];

/** A regional manager's thread as the tick reads it, to fire its reminders. */
type ListedThread = { id: string; archivedAt: number | null; deletedAt: number | null };

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
      list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]>;
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
  | "commentIssue"
  | "issues"
  | "check"
  | "insertHandoff"
  | "record"
  | "giveUpCheck"
  | "settleReturned"
  | "endAgent"
  | "setVerify"
  | "insertEvent"
  | "unannounced"
  | "coordinatorsToRing"
  | "announce"
  | "unread"
  | "markRead"
  | "doorbell"
  | "doorbells"
  | "clearDoorbell"
  | "reopenDoorbell"
  | "savePrRead"
  | "markPrUnavailable"
  | "dueReminders"
  | "fireReminder"
  | "decision"
  | "answerDecision"
  | "recordOwnTree"
  | "recordUnblocked"
>;

type Doorbell = ReturnType<Store["doorbells"]>[number];

type Deps = {
  bb: InboxBb;
  store: InboxStore;
  /** Where a research report is saved as its handoff is stored. */
  memory: Pick<MemoryRoot, "of">;
  /** Runs after every event, to refresh the coordinating thread's board. */
  onChange(id: CoordinatorId): void;
};

export type Inbox = ReturnType<typeof createInbox>;

export function createInbox({ bb, store, memory, onChange }: Deps) {
  // why: two events at once must not race two sends, and a send in flight must finish before the next.
  const ringing = new Set<CoordinatorId>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /**
   * Sends one doorbell for every unannounced event, unless one is in flight or still queued in bb,
   * or none of them wakes the thread on its own (see wakes): those wait for the next that does.
   */
  async function ring(id: CoordinatorId): Promise<void> {
    if (disposed || ringing.has(id) || store.doorbell(id) !== null) return;
    const coordinator = store.coordinator(id);
    const events = store.unannounced(id);
    // why: a regional manager with no thread bound yet, not started or not answered by bb's spawn yet, is rung by the tick once it has one.
    if (coordinator === null || !events.some(({ event }) => wakes(event))) return;
    ringing.add(id);
    let delivery: "sent" | "queued";
    try {
      const text = doorbellText(events, {
        titles: new Map(store.issues(id).map(({ id, title }) => [id, title])),
        check: store.check,
        decision: store.decision,
      });
      // why agent-only: the model reads the doorbell, but bb draws no message for it, so the user sees only the turn it starts.
      const sent = await bb.sdk.threads.send({ threadId: coordinator.threadId, input: [{ type: "text", text, visibility: "agent-only", mentions: [] }], mode: "queue-if-active" });
      // why record a send that lands after a dispose: it happened, and announcing it again would ring twice.
      store.announce(id, events.map((event) => event.id), sent.delivery === "queued" ? sent.queuedMessage.id : null, Date.now());
      delivery = sent.delivery;
    } catch (error) {
      bb.log.warn(`Could not wake the regional manager ${coordinator.threadId}; the next tick tries again: ${messageOf(error)}`);
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
   * Takes back a doorbell still waiting in bb's queue once every event is read: it would wake the
   * thread for nothing. One left unread keeps it, as one recorded while a catch-up read bb: the
   * doorbell may be all that announces it. If bb sent it meanwhile, the delete fails and nothing changes.
   */
  async function withdraw(id: CoordinatorId): Promise<void> {
    const queuedMessageId = store.doorbell(id);
    const coordinator = store.coordinator(id);
    if (disposed || queuedMessageId === null || coordinator === null || store.unread(id).length > 0) return;
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

  /**
   * Records every reminder due at `now` whose regional manager bb runs, unless it was cancelled or
   * recorded since it was read (see fireReminder). One of a thread bb lists as archived stays due,
   * and fires once the thread is unarchived; a deleted manager's are removed with it by the agents'
   * reconcile. why no ring here: the tick's own ring follows, so one doorbell carries them with
   * whatever else the tick found.
   */
  async function fireDueReminders(now: number): Promise<void> {
    const due = store.dueReminders(now);
    if (due.length === 0) return;
    const threads = await threadsById(bb, [...new Set(due.map((reminder) => reminder.threadId))]);
    if (disposed) return;
    for (const { id, threadId } of due) {
      const thread = threads.get(threadId);
      if (thread !== undefined && isLive(thread)) store.fireReminder(id, now);
    }
  }

  /** Stores the handoff with `insert`, with the file its report is saved to when it delivers one. */
  function stored<T>(given: GivenHandoff, insert: (handoff: Handoff) => T): T {
    if (given.status !== "done") return insert(given);
    const { delivery } = given;
    if (delivery.kind === "commit") return insert({ ...given, delivery });
    const earlier = store.record(given.coordinatorId, given.issueId).map(({ handoff }) => handoff);
    return storeReport(memory.of(given.coordinatorId), given.issueId, earlier, delivery.report, (file) => insert({ ...given, delivery: { ...delivery, file } }));
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
     * Stores the handoff with its check, and its event unless a verifier is still to check it, saving
     * a report it delivers to its file together with it (see storeReport), then wakes its regional
     * manager. Returns what the store did (see insertHandoff).
     */
    handoff(given: GivenHandoff, checkout: CheckoutRead): ReturnType<Store["insertHandoff"]> {
      const inserted = stored(given, (handoff) => store.insertHandoff(handoff, checkout));
      recorded(given.coordinatorId);
      return inserted;
    },

    /** Gives up on a waiting check at `at` and announces it checked, if it is still where `from` says. */
    giveUpCheck(checkId: CheckId, from: VerdictFrom, why: GivenUp, at: number): void {
      const id = store.giveUpCheck(checkId, from, why, at);
      if (id !== null) recorded(id);
    },

    /** Settles a returned verdict as `as` says and announces it, unless it was settled already (see settleReturned). */
    settleCheck(checkId: CheckId, as: Settlement): void {
      const id = store.settleReturned(checkId, as, Date.now());
      if (id !== null) recorded(id);
    },

    /** Ends the agent with what it left, and tells its regional manager when its issue returned to Todo (see endAgent). */
    endAgent(agent: Pick<Agent, "coordinatorId" | "id" | "issueId">, how: EndedHow, left: HandoffId | null, placed: boolean): void {
      if (store.endAgent(agent, how, left, placed, Date.now())) recorded(agent.coordinatorId);
    },

    /**
     * Saves a successful read of a branch's pull request (null: none), begun at the handoff
     * `handoffAtRead`, with a `pr` event naming `on` when it changed meaningfully. The board reads it
     * again either way: its CI may have moved. why no ring here: the watch reads only on the tick,
     * whose own ring follows.
     */
    prRead(coordinatorId: CoordinatorId, branch: string, on: { issueId: IssueId; agentId: AgentId }, pr: PrSnapshot | null, handoffAtRead: HandoffId | null, at: number): void {
      store.savePrRead(coordinatorId, branch, on, pr, handoffAtRead, at);
      onChange(coordinatorId);
    },

    /** Records why reading a branch's pull request failed, and whether that lasts; its snapshot stays, and nobody is woken. */
    prUnavailable(coordinatorId: CoordinatorId, branch: string, unavailable: PrUnavailable, at: number): void {
      store.markPrUnavailable(coordinatorId, branch, unavailable, at);
      onChange(coordinatorId);
    },

    /** The user's switch: turns verification on or off, and tells the coordinating thread when it changed. */
    setVerify(id: CoordinatorId, verify: boolean): void {
      if (store.setVerify(id, verify, Date.now())) recorded(id);
    },

    /** The user's answer to a decision: stores it and wakes the coordinating thread, unless it can't be stored (see answerDecision). */
    answerDecision(id: CoordinatorId, decisionId: DecisionId, answer: string): ReturnType<Store["answerDecision"]> {
      const outcome = store.answerDecision(id, decisionId, answer, Date.now());
      if (outcome === "answered") recorded(id);
      return outcome;
    },

    /**
     * A comment on one of the regional manager's issues: stores it with what the regional manager is
     * told of it, then shows it and rings, which only the user's comment wakes it for (see
     * commentIssue). Returns its id; null when it answers no comment of the same issue.
     */
    commentIssue(id: CoordinatorId, comment: NewComment): CommentId | null {
      const commentId = store.commentIssue(id, comment, Date.now());
      if (commentId !== null) recorded(id);
      return commentId;
    },

    /**
     * A read of the coordinating thread's own working tree as its turn ended: records it when the
     * board doesn't already say it (see ownTreeEventAfter), then rings, which a clean tree alone doesn't.
     */
    ownTreeRead(id: CoordinatorId, fileCount: number): void {
      if (store.recordOwnTree(id, fileCount, Date.now())) recorded(id);
    },

    /**
     * Records what every issue as viewed just now (`views`, read whole) says was unblocked since the
     * last such read (see recordUnblocked), and wakes the coordinating thread when it recorded one.
     */
    unblocked(id: CoordinatorId, views: readonly IssueView[]): void {
      if (store.recordUnblocked(id, views, Date.now())) recorded(id);
    },

    /** Stores the event, then wakes its coordinating thread. A crash between the two is rung by the next tick. */
    record(id: CoordinatorId, event: InboxEvent): void {
      store.insertEvent(id, event, Date.now());
      recorded(id);
    },

    /** Every unread event, whole, oldest first, left unread until a catch-up that returned them marks them read (markRead). */
    unread: (id: CoordinatorId): StoredEvent[] => store.unread(id),

    /**
     * Marks the events read, as a catch-up returned them whole. A doorbell still queued is taken back
     * once nothing is left unread (see withdraw), which rings again for any event recorded since.
     */
    markRead(id: CoordinatorId, events: readonly StoredEvent[]): void {
      store.markRead(id, events.map((event) => event.id), Date.now());
      withdraw(id).catch((error: unknown) => bb.log.warn(`Could not take back the doorbell of ${id}: ${messageOf(error)}`));
    },

    /**
     * The once-a-minute pass, at `now`. It records the reminders that came due, forgets a queued
     * doorbell bb no longer has, because its `message.dispatched` can be missed while the plugin
     * reloads, and one bb gave up sending, then rings every coordinating thread with an event left
     * unannounced (a reminder, a failed send, a crash after a write, a doorbell bb gave up on).
     */
    async tick(now: number): Promise<void> {
      // why caught: reminders bb can't look up must not keep the doorbells from ringing.
      await fireDueReminders(now).catch((error: unknown) => bb.log.warn(`Could not check the reminders; the next tick tries again: ${messageOf(error)}`));
      for (const doorbell of store.doorbells()) {
        if (disposed) return;
        await check(doorbell);
      }
      await Promise.all(store.coordinatorsToRing().map(ring));
    },
  };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
