// Pull requests and CI, which bb never pushes: on the one-minute tick, the watch reads the pull
// request of every open issue's branch (its latest agent's with one) from GitHub, once per branch,
// one `gh api graphql` call per repository, whether or not that agent's thread is still live: an
// issue In review whose agent's thread was archived still becomes Done when its pull request
// merges. It saves each successful read and records a `pr` event when one changed meaningfully; the
// verify step's pass, after it in the same tick, settles the verdicts that wait for CI. A failed
// read keeps what was saved and says why on the board.
import { issueBranch, type Agent } from "../../model/agent.ts";
import { shipsCode } from "../../model/issue/kind.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { ciRunning, type PrSnapshot, type PrUnavailable } from "../../model/verdict/pr.ts";
import { threadsById } from "../agents/threads.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { ghFailure, UNREADABLE_ANSWER } from "./gh-failure.ts";
import { parseHostCommandFailure } from "./host-command.ts";
import { parseGitHubRepo, parsePrs, prQueryArgs, type Repo } from "./pr-query.ts";

/** How often a repository with no CI running and no verdict waiting for it is read. */
const QUIET_POLL_MS = 5 * 60_000;

/** Why an issue whose project has no GitHub remote has no pull request the plugin can read. */
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
  store: Pick<Store, "coordinators" | "issues" | "issue" | "agents" | "prOfBranch" | "waitingForCi" | "latestHandoff">;
  inbox: Pick<Inbox, "prRead" | "prUnavailable">;
  /** Runs gh with these arguments and resolves to its stdout; rejects as Node's execFile does. */
  gh(args: string[]): Promise<string>;
};

/** A branch the watch reads: its regional manager, the agent last on it, in a repository on GitHub (null: its project's remote isn't). */
type Watched = { coordinatorId: CoordinatorId; agent: Agent; branch: string; repo: Repo | null };

export function createPrWatch({ bb, store, inbox, gh }: Deps) {
  // why: a tick that outlasts the minute must not overlap the next, or one read could save over a newer one.
  let running = false;
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /**
   * Every open issue's branch (issueBranch), of a kind that ships code, whose pull request may still
   * change, once per branch, grouped by repository; a null key holds those not on GitHub.
   */
  async function watched(): Promise<Map<string | null, Watched[]>> {
    const groups = new Map<string | null, Watched[]>();
    for (const coordinator of store.coordinators()) {
      const open = store.issues(coordinator.id).filter((issue) => issue.closed === null && shipsCode(issue.kind));
      const agents = store.agents(coordinator.id).filter((agent) => open.some((issue) => issue.id === agent.issueId));
      if (agents.length === 0) continue;
      const { gitRemoteUrl } = await bb.sdk.projects.get({ projectId: coordinator.projectId });
      const repo = gitRemoteUrl === null ? null : parseGitHubRepo(gitRemoteUrl);
      // why archived ones too: an agent's branch outlives its thread.
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      const threadOf = (agent: Agent) => (agent.threadId === null ? null : (threads.get(agent.threadId) ?? null));
      const seen = new Set<string>();
      for (const issue of open) {
        const on = issueBranch(agents.filter((agent) => agent.issueId === issue.id), threadOf);
        if (on === null) continue;
        const { agent, branch } = on;
        if (seen.has(branch) || finished(coordinator.id, branch, agent)) continue;
        seen.add(branch);
        // why lower case: GitHub matches an owner and a name in any case, so two spellings are one repository.
        const key = repo?.toLowerCase() ?? null;
        groups.set(key, [...(groups.get(key) ?? []), { coordinatorId: coordinator.id, agent, branch, repo }]);
      }
    }
    return groups;
  }

  /** The id of the agent's latest handoff, which a read is as of (null: none). */
  const latestHandoffOf = (agent: Agent) => store.latestHandoff(agent.coordinatorId, agent.id)?.handoff.id ?? null;

  /**
   * Whether a read found the branch's pull request merged or closed, and its agent hasn't handed off
   * since. why not read it again: a finished pull request has nothing left to wait for, and the
   * agent's next handoff, which comes with any pull request it reopens or opens, makes it due again.
   */
  function finished(coordinatorId: CoordinatorId, branch: string, agent: Agent): boolean {
    const status = store.prOfBranch(coordinatorId, branch);
    if (status === null || status.snapshot === null || status.snapshot.state === "open") return false;
    return status.handoffAtRead === latestHandoffOf(agent);
  }

  /** Whether a repository's branches are due a read: one never read, CI running, a verdict waiting for CI, or the quiet interval passed. */
  function due(branches: readonly Watched[], now: number): boolean {
    return branches.some(({ coordinatorId, agent, branch }) => {
      const status = store.prOfBranch(coordinatorId, branch);
      if (status === null || store.waitingForCi(coordinatorId, agent.id).length > 0) return true;
      return (status.snapshot !== null && ciRunning(status.snapshot)) || now - status.polledAt >= QUIET_POLL_MS;
    });
  }

  /** One read of every branch of the repository: the pull request of each (null: none), or why it failed. */
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

  /**
   * Reads the repository's branches and saves what each read found, as of each agent's latest
   * handoff when the read began. Branches not on GitHub are only marked when a verdict waits on their
   * CI, which then can't be checked.
   */
  async function poll(branches: readonly Watched[], now: number): Promise<void> {
    const repo = branches[0]?.repo ?? null;
    // why before gh runs: a handoff made while it runs came after what it answers.
    const reading = branches.map((watched) => ({ ...watched, handoffAtRead: latestHandoffOf(watched.agent) }));
    const result = repo === null ? null : await read(repo, [...new Set(branches.map(({ branch }) => branch))]);
    for (const { coordinatorId, agent, branch, handoffAtRead } of reading) {
      if (disposed) return;
      // why read the issue again: the regional manager may have closed it while gh ran.
      if (store.issue(coordinatorId, agent.issueId)?.closed !== null) continue;
      if (result === null) {
        if (store.waitingForCi(coordinatorId, agent.id).length === 0) continue;
        inbox.prUnavailable(coordinatorId, branch, NOT_ON_GITHUB, now);
      } else if (result.kind === "read") inbox.prRead(coordinatorId, branch, { issueId: agent.issueId, agentId: agent.id }, result.prs.get(branch) ?? null, handoffAtRead, now);
      else inbox.prUnavailable(coordinatorId, branch, result.unavailable, now);
    }
  }

  return {
    /** The tick's pass: reads every repository that is due. A branch no open issue's latest agent is on is never read. */
    async tick(now: number): Promise<void> {
      if (disposed || running) return;
      running = true;
      try {
        for (const branches of (await watched()).values()) {
          if (disposed) return;
          if (due(branches, now)) await poll(branches, now);
        }
      } finally {
        running = false;
      }
    },
  };
}
