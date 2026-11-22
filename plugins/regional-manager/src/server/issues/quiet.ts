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

type QuietStore = Pick<Store, "coordinator" | "agents" | "issueThreads" | "roleOfThread" | "markNudged">;

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
  const settled = await Promise.allSettled(
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
  const failed = settled.find((one): one is PromiseRejectedResult => one.status === "rejected");
  if (failed !== undefined) throw failed.reason;
  const each = settled.flatMap((one) => (one.status === "fulfilled" ? [one.value] : []));
  return { withdrawn: each.flatMap((one) => one.withdrawn), left: each.flatMap((one) => one.left) };
}

function oweReminder(store: QuietStore, verifierThreadId: string, owed: boolean): void {
  const role = store.roleOfThread(verifierThreadId);
  if (role?.kind === "verifier") store.markNudged(role.checkId, verifierThreadId, !owed);
}

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

const threadName = ({ threadId, agentId }: IssueThread): string => agentId ?? `the verifier @thread:${threadId}`;

const textOf = (content: QueuedMessage["content"]): string => content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");

const bbSends = ({ state }: { state: string }): boolean => state !== "failed_exhausted";
