import { issueBranch, type Agent } from "../../model/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { shipsCode } from "../../model/issue/kind.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { ciRunning, type PrRead, type PrSnapshot, type PrUnavailable } from "../../model/verdict/pr.ts";
import { threadsById } from "../agents/threads.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { ghFailure, UNREADABLE_ANSWER } from "./gh-failure.ts";
import { parseHostCommandFailure } from "./host-command.ts";
import { parseGitHubRepo, parsePrs, prQueryArgs, type Repo } from "./pr-query.ts";

const QUIET_POLL_MS = 5 * 60_000;

const NOT_ON_GITHUB: PrUnavailable = { kind: "persistent", reason: "its project's git remote isn't on github.com" };

/** An agent's thread as the watch reads it. */
type ListedThread = { id: string; environmentBranchName: string | null };

/** The parts of bb the watch uses, down to the fields it reads. */
type WatchBb = {
  onDispose(hook: () => void): void;
  sdk: {
    threads: { list(args: { threadIds: string[]; includeHidden: true; limit: number }): Promise<ListedThread[]> };
    projects: { get(args: { projectId: string }): Promise<{ gitRemoteUrl: string | null }> };
  };
};

type Deps = {
  bb: WatchBb;
  store: Pick<Store, "coordinator" | "coordinators" | "issues" | "issue" | "agents" | "prOfBranch" | "waitingForCi" | "latestHandoff">;
  inbox: Pick<Inbox, "prRead" | "prUnavailable">;
  /** Runs gh with these arguments and resolves to its stdout; rejects as Node's execFile does. */
  gh(args: string[]): Promise<string>;
  /** The time a read outside the tick is saved at. */
  now(): number;
};

type Watched = { coordinatorId: CoordinatorId; agent: Agent; branch: string; repo: Repo | null };

export type PrWatch = ReturnType<typeof createPrWatch>;

export function createPrWatch({ bb, store, inbox, gh, now }: Deps) {
  let running = false;
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });
  let reads: Promise<unknown> = Promise.resolve();
  function serially<T>(read: () => Promise<T>): Promise<T> {
    const next = reads.then(read, read);
    reads = next.catch(() => {});
    return next;
  }

  async function repoOf(coordinatorId: CoordinatorId): Promise<Repo | null> {
    const coordinator = store.coordinator(coordinatorId);
    if (coordinator === null) throw new Error(`No regional manager ${coordinatorId}.`);
    const { gitRemoteUrl } = await bb.sdk.projects.get({ projectId: coordinator.projectId });
    return gitRemoteUrl === null ? null : parseGitHubRepo(gitRemoteUrl);
  }

  async function watched(): Promise<Map<string | null, Watched[]>> {
    const groups = new Map<string | null, Watched[]>();
    for (const coordinator of store.coordinators()) {
      const issues = store.issues(coordinator.id);
      const open = issues.filter((issue) => watches(issue, issues));
      const agents = store.agents(coordinator.id).filter((agent) => open.some((issue) => issue.id === agent.issueId));
      if (agents.length === 0) continue;
      const repo = await repoOf(coordinator.id);
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      const threadOf = (agent: Agent) => (agent.threadId === null ? null : (threads.get(agent.threadId) ?? null));
      const seen = new Set<string>();
      for (const issue of open) {
        const on = issueBranch(agents.filter((agent) => agent.issueId === issue.id), threadOf);
        if (on === null) continue;
        const { agent, branch } = on;
        if (seen.has(branch) || finished(coordinator.id, branch, agent)) continue;
        seen.add(branch);
        const key = repo?.toLowerCase() ?? null;
        groups.set(key, [...(groups.get(key) ?? []), { coordinatorId: coordinator.id, agent, branch, repo }]);
      }
    }
    return groups;
  }

  const latestHandoffOf = (agent: Agent) => store.latestHandoff(agent.coordinatorId, agent.id)?.handoff.id ?? null;

  function finished(coordinatorId: CoordinatorId, branch: string, agent: Agent): boolean {
    const status = store.prOfBranch(coordinatorId, branch);
    if (status === null || status.snapshot === null || status.snapshot.state === "open") return false;
    return status.handoffAtRead === latestHandoffOf(agent);
  }

  function due(branches: readonly Watched[], now: number): boolean {
    return branches.some(({ coordinatorId, agent, branch }) => {
      const status = store.prOfBranch(coordinatorId, branch);
      if (status === null || store.waitingForCi(coordinatorId, agent.id).length > 0) return true;
      return (status.snapshot !== null && ciRunning(status.snapshot)) || now - status.polledAt >= QUIET_POLL_MS;
    });
  }

  async function read(repo: Repo, branches: readonly string[]): Promise<{ kind: "read"; prs: Map<string, PrSnapshot | null> } | { kind: "unavailable"; unavailable: PrUnavailable }> {
    let stdout: string;
    try {
      stdout = await gh(prQueryArgs(repo, branches));
    } catch (error) {
      return { kind: "unavailable", unavailable: ghFailure(parseHostCommandFailure(error)) };
    }
    const prs = parsePrs(stdout, branches);
    return prs === null ? { kind: "unavailable", unavailable: UNREADABLE_ANSWER } : { kind: "read", prs };
  }

  async function poll(branches: readonly Watched[], now: number): Promise<void> {
    const repo = branches[0]?.repo ?? null;
    const reading = branches.map((watched) => ({ ...watched, handoffAtRead: latestHandoffOf(watched.agent) }));
    const result = repo === null ? null : await read(repo, [...new Set(branches.map(({ branch }) => branch))]);
    for (const { coordinatorId, agent, branch, handoffAtRead } of reading) {
      if (disposed) return;
      const issue = store.issue(coordinatorId, agent.issueId);
      if (issue === null || !watches(issue, store.issues(coordinatorId))) continue;
      if (result === null) {
        if (store.waitingForCi(coordinatorId, agent.id).length === 0) continue;
        inbox.prUnavailable(coordinatorId, branch, NOT_ON_GITHUB, now);
      } else if (result.kind === "read") inbox.prRead(coordinatorId, branch, { issueId: agent.issueId, agentId: agent.id }, result.prs.get(branch) ?? null, handoffAtRead, now);
      else inbox.prUnavailable(coordinatorId, branch, result.unavailable, now);
    }
  }

  async function readOne(coordinatorId: CoordinatorId, agent: Agent, branch: string): Promise<PrRead> {
    const repo = await repoOf(coordinatorId);
    if (repo === null) return { kind: "unread", reason: NOT_ON_GITHUB.reason };
    const handoffAtRead = latestHandoffOf(agent);
    const result = await read(repo, [branch]);
    if (result.kind === "unavailable") {
      inbox.prUnavailable(coordinatorId, branch, result.unavailable, now());
      return { kind: "unread", reason: result.unavailable.reason };
    }
    const pr = result.prs.get(branch) ?? null;
    inbox.prRead(coordinatorId, branch, { issueId: agent.issueId, agentId: agent.id }, pr, handoffAtRead, now());
    return { kind: "read", pr };
  }

  return {
    async tick(at: number): Promise<void> {
      if (disposed || running) return;
      running = true;
      try {
        await serially(async () => {
          for (const branches of (await watched()).values()) {
            if (disposed) return;
            if (due(branches, at)) await poll(branches, at);
          }
        });
      } finally {
        running = false;
      }
    },

    readNow: (coordinatorId: CoordinatorId, agent: Agent, branch: string): Promise<PrRead> => serially(() => readOne(coordinatorId, agent, branch)),
  };
}

function watches(issue: Issue, issues: readonly Issue[]): boolean {
  if (!shipsCode(issue.kind)) return false;
  if (issue.closed === null) return true;
  const parent = issues.find(({ id }) => id === issue.parentId);
  return issue.closed.as === "accepted" && parent !== undefined && parent.closed === null;
}
