import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import type { Agent, AgentId, EndedHow } from "../../model/agent.ts";
import type { DecisionId } from "../../model/decision.ts";
import type { GivenHandoff, Handoff, HandoffId } from "../../model/handoff.ts";
import { wakes, type InboxEvent, type StoredEvent } from "../../model/inbox/inbox-event.ts";
import { doorbellText } from "../../model/inbox/wake-text.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { IssueView } from "../../model/issue/status.ts";
import type { CoordinatorId } from "../../model/role.ts";
import type { CheckId } from "../../model/verdict/check.ts";
import type { CheckoutRead } from "../../model/verdict/checkout.ts";
import type { PrSnapshot, PrUnavailable } from "../../model/verdict/pr.ts";
import type { Verdict } from "../../model/verdict/verdict.ts";
import { isLive, threadsById } from "../agents/threads.ts";
import type { MemoryRoot } from "../memory/memory-files.ts";
import { storeReport } from "../memory/report-file.ts";
import type { Settlement, VerdictFrom } from "../store/issue/checks-store.ts";
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
  | "takeUnread"
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
  const ringing = new Set<CoordinatorId>();
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  async function ring(id: CoordinatorId): Promise<void> {
    if (disposed || ringing.has(id) || store.doorbell(id) !== null) return;
    const coordinator = store.coordinator(id);
    const events = store.unannounced(id);
    if (coordinator === null || !events.some(({ event }) => wakes(event))) return;
    ringing.add(id);
    let delivery: "sent" | "queued";
    try {
      const sent = await bb.sdk.threads.send({ threadId: coordinator.threadId, input: [{ type: "text", text: doorbellText(events, { titles: new Map(store.issues(id).map(({ id, title }) => [id, title])), check: store.check, decision: store.decision }), mentions: [] }], mode: "queue-if-active" });
      store.announce(id, events.map((event) => event.id), sent.delivery === "queued" ? sent.queuedMessage.id : null, Date.now());
      delivery = sent.delivery;
    } catch (error) {
      bb.log.warn(`Could not wake the regional manager ${coordinator.threadId}; the next tick tries again: ${messageOf(error)}`);
      return;
    } finally {
      ringing.delete(id);
    }
    if (delivery === "sent") await ring(id);
  }

  function ringSoon(id: CoordinatorId): void {
    ring(id).catch((error: unknown) => bb.log.warn(`Could not ring ${id}: ${messageOf(error)}`));
  }

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
    if (store.clearDoorbell(queuedMessageId) !== null) await ring(id);
  }

  async function check(doorbell: Doorbell): Promise<void> {
    const queue = await queueOf(doorbell);
    if (queue === null) return;
    const queued = queue.find((message) => message.id === doorbell.queuedMessageId);
    if (queued === undefined) store.clearDoorbell(doorbell.queuedMessageId);
    else if (queued.state === "failed_exhausted") await giveUp(doorbell, queued.failureReason);
  }

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
    store.reopenDoorbell(queuedMessageId);
    try {
      await bb.sdk.threads.queuedMessages.delete({ threadId, queuedMessageId });
    } catch (error) {
      bb.log.warn(`Could not take the failed doorbell ${queuedMessageId} out of the queue of ${threadId}; it stays there, failed: ${messageOf(error)}`);
    }
  }

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

  const settle = ({ entry }: { entry: { id: string } }) => {
    const id = store.clearDoorbell(entry.id);
    if (id !== null) ringSoon(id);
  };
  bb.events.on("message.dispatched", settle);
  bb.events.on("message.cancelled", settle);

  return {
    handoff(given: GivenHandoff, checkout: CheckoutRead): ReturnType<Store["insertHandoff"]> {
      const inserted = stored(given, (handoff) => store.insertHandoff(handoff, checkout));
      recorded(given.coordinatorId);
      return inserted;
    },

    giveUpCheck(checkId: CheckId, from: VerdictFrom, verdict: Extract<Verdict, { state: "could-not-run" }>): void {
      const id = store.giveUpCheck(checkId, from, verdict, Date.now());
      if (id !== null) recorded(id);
    },

    settleCheck(checkId: CheckId, as: Settlement): void {
      const id = store.settleReturned(checkId, as, Date.now());
      if (id !== null) recorded(id);
    },

    endAgent(agent: Pick<Agent, "coordinatorId" | "id" | "issueId">, how: EndedHow, left: HandoffId | null, placed: boolean): void {
      if (store.endAgent(agent, how, left, placed, Date.now())) recorded(agent.coordinatorId);
    },

    prRead(coordinatorId: CoordinatorId, branch: string, on: { issueId: IssueId; agentId: AgentId }, pr: PrSnapshot | null, handoffAtRead: HandoffId | null, at: number): void {
      store.savePrRead(coordinatorId, branch, on, pr, handoffAtRead, at);
      onChange(coordinatorId);
    },

    prUnavailable(coordinatorId: CoordinatorId, branch: string, unavailable: PrUnavailable, at: number): void {
      store.markPrUnavailable(coordinatorId, branch, unavailable, at);
      onChange(coordinatorId);
    },

    setVerify(id: CoordinatorId, verify: boolean): void {
      if (store.setVerify(id, verify, Date.now())) recorded(id);
    },

    answerDecision(id: CoordinatorId, decisionId: DecisionId, answer: string): ReturnType<Store["answerDecision"]> {
      const outcome = store.answerDecision(id, decisionId, answer, Date.now());
      if (outcome === "answered") recorded(id);
      return outcome;
    },

    ownTreeRead(id: CoordinatorId, fileCount: number): void {
      if (store.recordOwnTree(id, fileCount, Date.now())) recorded(id);
    },

    unblocked(id: CoordinatorId, views: readonly IssueView[]): void {
      if (store.recordUnblocked(id, views, Date.now())) recorded(id);
    },

    record(id: CoordinatorId, event: InboxEvent): void {
      store.insertEvent(id, event, Date.now());
      recorded(id);
    },

    takeUnread(id: CoordinatorId): StoredEvent[] {
      const events = store.takeUnread(id, Date.now());
      withdraw(id).catch((error: unknown) => bb.log.warn(`Could not take back the doorbell of ${id}: ${messageOf(error)}`));
      return events;
    },

    async tick(now: number): Promise<void> {
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
