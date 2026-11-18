// Quieting an issue: what the plugin does each time it gives the environment of an issue's work to
// one thread of it, so no other thread of the issue runs there beside it. Five places do: an agent's
// start or handover and a manager's message to the agent (agents.ts), a verifier's start, a reminder
// to a verifier and a failed verdict's findings sent back to the agent (verify.ts). Each calls
// quietIssue in the issue's turn (issue-turns.ts) and acts only once it answers quiet; otherwise
// each keeps its own outcome: a start refused, a check left queued, a reminder left for the next
// look, findings left owed, a message refused.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { holderOf, type AgentId } from "../../model/agent.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { stopThreads, threadsById, type StopBb } from "../agents/threads.ts";
import type { Store } from "../store/store.ts";

type QueuedMessage = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["queuedMessages"]["list"]>>[number];

/** The parts of bb quieting uses: the issue's threads, their queues, and the stop. */
export type QuietBb = StopBb & {
  sdk: {
    threads: {
      queuedMessages: {
        list(args: { threadId: string }): Promise<Pick<QueuedMessage, "id" | "senderThreadId" | "state" | "content">[]>;
        delete(args: { threadId: string; queuedMessageId: string }): Promise<unknown>;
      };
    };
  };
};

export type QuietStore = Pick<Store, "coordinator" | "agents" | "issueThreads" | "roleOfThread" | "markNudged">;

/**
 * Whom the issue's environment goes to: a new agent, which replaces the issue's holder; or one of
 * the issue's threads (`threadId`), its holder's or a verifier's, null for a verifier about to
 * start, while the holder keeps the issue.
 */
export type GivenTo = { kind: "new-agent" } | { kind: "thread"; threadId: string | null };

/** A regional manager's message taken back from bb's queue: the agent it was to, which never got it, and its text. */
export type Withdrawn = { to: AgentId; text: string };

/** A message bb still has queued for a thread of the issue: the thread, in words, and the message (see senderText). `owed`: queued for the holder, which keeps the issue and gets it in time. */
type Left = { to: string; what: string; owed: boolean };

/**
 * What quieting did: the manager's messages it took back (`withdrawn`) and the threads bb reported
 * running that it stopped, in words (`stopped`); and whether the issue is quiet now. Not while bb
 * still has a message queued that would wake a thread (`left`), and then nothing was stopped, since
 * a stop sends the queue; nor while bb hasn't confirmed a thread stopped (`unstopped`: the thread,
 * in words, and why).
 */
export type Quieted = { withdrawn: Withdrawn[]; stopped: string[] } & (
  | { kind: "quiet" }
  | { kind: "left"; left: Left[] }
  | { kind: "unstopped"; unstopped: { thread: string; why: string }[] }
);

export type Unquiet = Exclude<Quieted, { kind: "quiet" }>;

/** One of the threads the plugin started for an issue: an agent's, or (agentId null) a verifier's. */
type IssueThread = { threadId: string; agentId: AgentId | null };

/**
 * Quiets every thread of the issue but the one given its environment (`to`), in the issue's turn:
 * 1. takes back what the plugin queued in bb for them, and reads each queue again (see
 *    withdrawQueued); with anything left that bb would send, it stops nothing and says so;
 * 2. stops each, whatever status bb reports, never archiving one (see stopThreads): a thread bb
 *    reports idle can still hold a background command whose finish wakes it;
 * 3. answers quiet only once bb confirms each stopped.
 * why every thread of the issue, ended agents' and superseded verifiers' too: what bb queued for one
 * wakes it as surely as for the holder. why the giver's own thread too, its agent's or a verifier's:
 * that is the side giving the environment up.
 */
export async function quietIssue(bb: QuietBb, store: QuietStore, coordinatorId: CoordinatorId, issueId: IssueId, to: GivenTo): Promise<Quieted> {
  const coordinator = store.coordinator(coordinatorId);
  // why throw: every caller acts for a regional manager the store holds, and its issues are kept while it is.
  if (coordinator === null) throw new Error(`The regional manager ${coordinatorId} is missing.`);
  const threads = store.issueThreads(coordinatorId, issueId).filter(({ threadId }) => to.kind === "new-agent" || threadId !== to.threadId);
  const named = (threadId: string): string => threadName({ threadId, agentId: threads.find((thread) => thread.threadId === threadId)?.agentId ?? null });
  const owedTo = to.kind === "new-agent" ? null : (holderOf(store.agents(coordinatorId), issueId)?.threadId ?? null);
  const { withdrawn, left } = await withdrawQueued(bb, store, coordinator.threadId, threads, owedTo);
  if (left.length > 0) return { kind: "left", withdrawn, stopped: [], left };
  const { stopped, unstopped } = await stopThreads(bb, threads.map(({ threadId }) => threadId));
  const done = { withdrawn, stopped: stopped.map(named) };
  if (unstopped.length > 0) return { kind: "unstopped", ...done, unstopped: unstopped.map(({ threadId, why }) => ({ thread: named(threadId), why })) };
  return { kind: "quiet", ...done };
}

/**
 * Takes back the messages the plugin queued in bb for the threads (`threads`) that bb still has,
 * which bb would send once a thread's turn stops: the regional manager's to agents and the plugin's
 * reminders to verifiers, both sent from the manager's thread (`managerThreadId`), and the issue's
 * verifiers' findings to agents, as bb names their sender. Then reads each queue again, and returns
 * everything still there that bb would send (`left`), a message someone else queued included; and
 * the manager's messages it took back, with the agent each was to (`withdrawn`). A verifier's
 * reminder it finds is owed again (see oweReminder) unless the second read shows bb still has it.
 * why a person's message is left: it isn't the plugin's to delete. why the holder's (`owedTo`,
 * null: none kept) are left too: the holder keeps the issue and is owed them, the manager's next
 * instruction or a verifier's findings, which nothing else would bring again; they are its next work, so the thread taking the environment waits for them.
 * why read again, not trust a delete's answer: bb refuses one for a message it sent meanwhile and
 * fails one it never reached alike. One bb sent meanwhile reached its thread, and the stop after
 * this ends the turn it started. why a reminder is owed again before its delete, not once quieting
 * succeeds: a delete bb did, whose answer or the read after it failed, would leave its check
 * counted as reminded, and its verifier's next stop would give the check up with no reminder sent.
 * A reminder bb sent meanwhile may then come twice; a second reminder costs less than a check
 * given up.
 */
async function withdrawQueued(
  bb: QuietBb,
  store: QuietStore,
  managerThreadId: string,
  threads: IssueThread[],
  owedTo: string | null,
): Promise<{ withdrawn: Withdrawn[]; left: Left[] }> {
  const ours = new Set([managerThreadId, ...threads.map((thread) => thread.threadId)]);
  const queue = bb.sdk.threads.queuedMessages;
  const fromManager = ({ senderThreadId }: { senderThreadId: string | null }): boolean => senderThreadId === managerThreadId;
  const listed = await threadsById(bb, threads.map(({ threadId }) => threadId));
  const kept = threads.filter(({ threadId }) => listed.get(threadId)?.deletedAt === null);
  const each = await Promise.all(
    kept.map(async (thread) => {
      const { threadId, agentId } = thread;
      const owed = threadId === owedTo;
      const mine = owed ? [] : (await queue.list({ threadId })).filter((message) => bbSends(message) && message.senderThreadId !== null && ours.has(message.senderThreadId));
      const reminder = agentId === null && mine.some(fromManager);
      if (reminder) oweReminder(store, threadId, true);
      const deleted = await Promise.all(mine.map(({ id }) => queue.delete({ threadId, queuedMessageId: id }).then(() => true, () => false)));
      const still = (await queue.list({ threadId })).filter(bbSends);
      if (reminder && still.some(fromManager)) oweReminder(store, threadId, false);
      return {
        withdrawn: agentId === null ? [] : mine.filter((message, i) => deleted[i] && fromManager(message)).map(({ content }) => ({ to: agentId, text: textOf(content) })),
        left: still.map(({ senderThreadId }) => ({ to: threadName(thread), what: senderText(managerThreadId, ours, senderThreadId, agentId === null), owed })),
      };
    }),
  );
  return { withdrawn: each.flatMap((one) => one.withdrawn), left: each.flatMap((one) => one.left) };
}

/**
 * Whether a verifier's reminder is owed again (`owed`): while its check still runs there, one taken
 * back from bb's queue before bb sent it can come again; one bb still has counts as sent.
 */
function oweReminder(store: QuietStore, verifierThreadId: string, owed: boolean): void {
  const role = store.roleOfThread(verifierThreadId);
  if (role?.kind === "verifier") store.markNudged(role.checkId, verifierThreadId, !owed);
}

/** A queued message, in words, by its sender: the manager's message to an agent, the plugin's reminder to a verifier (`toVerifier`), a verifier's findings, a person's, or another thread's. */
function senderText(managerThreadId: string, ours: ReadonlySet<string>, senderThreadId: string | null, toVerifier: boolean): string {
  if (senderThreadId === managerThreadId) return toVerifier ? "the plugin's reminder" : "your message";
  if (senderThreadId === null) return "a message from the user";
  return ours.has(senderThreadId) ? `findings from the verifier @thread:${senderThreadId}` : `a message from @thread:${senderThreadId}`;
}

/**
 * Why the issue isn't quiet, led by what quieting did (see didText): `Stopped the verifier
 * @thread:thr_7, but a1 is still active`, or `bb still has a message from the user queued for a1
 * and couldn't take it back`.
 */
export function unquietText(unquiet: Unquiet): string {
  return `${didText(unquiet)}${reasonText(unquiet)}`;
}

function reasonText(unquiet: Unquiet): string {
  switch (unquiet.kind) {
    case "left": {
      const queued = unquiet.left.filter(({ owed }) => !owed).map(({ what, to }) => `${what} queued for ${to}`);
      const owed = unquiet.left.filter(({ owed }) => owed).map(({ what, to }) => `${to} is still to get ${what} from bb's queue`);
      return [...(queued.length === 0 ? [] : [`bb still has ${queued.join(", and ")} and couldn't take it back`]), ...owed].join(", and ");
    }
    case "unstopped":
      return unquiet.unstopped.map(({ thread, why }) => `${thread} ${why}`).join(", and ");
    default:
      return unquiet satisfies never;
  }
}

/** What quieting did, in words that lead what follows ("" when nothing): `Took back your message to a1, which a1 never got and stopped the verifier @thread:thr_7, but `. */
export function didText({ withdrawn, stopped }: Pick<Quieted, "withdrawn" | "stopped">): string {
  const to = recipientsText(withdrawn);
  const took = withdrawn.length === 0 ? [] : [`took back ${withdrawn.length === 1 ? "your message" : `your ${withdrawn.length} messages`} to ${to}, which ${to} never got`];
  const did = [...took, ...(stopped.length === 0 ? [] : [`stopped ${stopped.join(" and ")}`])].join(" and ");
  return did === "" ? "" : `${did.charAt(0).toUpperCase()}${did.slice(1)}, but `;
}

/** The threads the messages were to, in words: `a1`, `a1 and the verifier @thread:thr_7`. */
export const recipientsText = (messages: readonly { to: string }[]): string => [...new Set(messages.map(({ to }) => to))].join(" and ");

/** A thread of an issue, in words: its agent's id, or `the verifier @thread:thr_7`. */
const threadName = ({ threadId, agentId }: IssueThread): string => agentId ?? `the verifier @thread:${threadId}`;

/** A queued message's text. */
const textOf = (content: QueuedMessage["content"]): string => content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

/** Whether bb sends a queued message on its own: every one but a message whose retries bb spent, which waits for the user. */
const bbSends = ({ state }: { state: string }): boolean => state !== "failed_exhausted";
