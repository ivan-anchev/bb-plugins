// Pull requests and CI, which bb never pushes: on the one-minute tick, the watch reads the pull
// request of every open issue's branch (its latest agent's with one) from GitHub, and of a sub-issue
// accepted unmerged while its parent is open (watches), once per branch,
// one `gh api graphql` call per repository, whether or not that agent's thread is still live: an
// issue In review whose agent's thread was archived still becomes Done when its pull request
// merges. It saves each successful read and records a `pr` event when one changed meaningfully; the
// verify step's pass, after it in the same tick, settles the verdicts that wait for CI. A failed
// read keeps what was saved and says why on the board. A handover that moves work through origin
// also reads one branch at once (readNow), saved the same way.
import { issueBranch, type Agent } from "../../model/agent/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { shipsCode } from "../../model/issue/kind.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { ciRunning, type PrRead, type PrSnapshot, type PrUnavailable } from "../../model/verdict/pr.ts";
import { threadsById } from "../agents/threads.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { ghFailure, UNREADABLE_ANSWER } from "./github/gh-failure.ts";
import { parseHostCommandFailure, type RunCli } from "./host-command.ts";
import { parseGitHubRepo, parsePrHead, parsePrs, parsePrUrl, prHeadQueryArgs, prQueryArgs, type Repo } from "./github/pr-query.ts";

/** How often a repository with no CI running and no verdict waiting for it is read. */
const QUIET_POLL_MS = 5 * 60_000;

/** Why an issue whose project has no GitHub remote has no pull request the plugin can read. */
const NOT_ON_GITHUB: PrUnavailable = { kind: "persistent", reason: "its project's git remote isn't on github.com", forge: null };

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
  store: Pick<Store, "coordinator" | "coordinators" | "issues" | "issue" | "agents" | "prOfBranch" | "waitingForCi" | "latestHandoff" | "record">;
  inbox: Pick<Inbox, "prRead" | "prUnavailable">;
  /** Runs gh or glab with these arguments and resolves to its stdout; rejects as Node's execFile does. */
  run: RunCli;
  /** The time a read outside the tick is saved at. */
  now(): number;
};

/** A branch the watch reads: its regional manager, the agent last on it, in a repository on GitHub (null: its project's remote isn't). */
type Watched = { coordinatorId: CoordinatorId; agent: Agent; branch: string; repo: Repo | null };

export type PrWatch = ReturnType<typeof createPrWatch>;

export function createPrWatch({ bb, store, inbox, run, now }: Deps) {
  // why: a tick that outlasts the minute must not overlap the next, or one read could save over a newer one.
  let running = false;
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });
  // The latest read asked for, the tick's or a move's, settled once it and every one before it are.
  // why one at a time: a read saves what GitHub said as it began, so one that overlapped a later one
  // could save an older head over a newer.
  let reads: Promise<unknown> = Promise.resolve();
  function serially<T>(read: () => Promise<T>): Promise<T> {
    const next = reads.then(read, read);
    reads = next.catch(() => {});
    return next;
  }

  /** The repository a regional manager's project is on, on GitHub; null when its git remote isn't. */
  async function repoOf(coordinatorId: CoordinatorId): Promise<Repo | null> {
    const coordinator = store.coordinator(coordinatorId);
    // why throw: a move reads the pull request of its own regional manager's issue.
    if (coordinator === null) throw new Error(`No regional manager ${coordinatorId}.`);
    const { gitRemoteUrl } = await bb.sdk.projects.get({ projectId: coordinator.projectId });
    return gitRemoteUrl === null ? null : parseGitHubRepo(gitRemoteUrl);
  }

  /**
   * Every open issue's branch (issueBranch), of a kind that ships code, whose pull request may still
   * change, once per branch, grouped by repository; a null key holds those not on GitHub.
   */
  async function watched(): Promise<Map<string | null, Watched[]>> {
    const groups = new Map<string | null, Watched[]>();
    for (const coordinator of store.coordinators()) {
      const issues = store.issues(coordinator.id);
      const open = issues.filter((issue) => watches(issue, issues));
      const agents = store.agents(coordinator.id).filter((agent) => open.some((issue) => issue.id === agent.issueId));
      if (agents.length === 0) continue;
      const repo = await repoOf(coordinator.id);
      // why archived ones too: an agent's branch outlives its thread.
      const threads = await threadsById(bb, agents.flatMap(({ threadId }) => (threadId === null ? [] : [threadId])));
      const threadOf = (agent: Agent) => (agent.threadId === null ? null : (threads.get(agent.threadId) ?? null));
      const seen = new Set<string>();
      for (const issue of open) {
        const on = issueBranch(agents.filter((agent) => agent.issueId === issue.id), threadOf, store.record(coordinator.id, issue.id));
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
      stdout = await run("gh", prQueryArgs(repo, branches));
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
      // why read the issues again: the regional manager may have closed the issue, or its parent, while gh ran.
      const issue = store.issue(coordinatorId, agent.issueId);
      if (issue === null || !watches(issue, store.issues(coordinatorId))) continue;
      if (result === null) {
        if (store.waitingForCi(coordinatorId, agent.id).length === 0) continue;
        inbox.prUnavailable(coordinatorId, branch, NOT_ON_GITHUB, now);
      } else if (result.kind === "read") inbox.prRead(coordinatorId, branch, { issueId: agent.issueId, agentId: agent.id }, result.prs.get(branch) ?? null, handoffAtRead, now);
      else inbox.prUnavailable(coordinatorId, branch, result.unavailable, now);
    }
  }

  /** Reads the branch's pull request now and saves what the read found as the tick does, `agent` being the one last on it. */
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
    /** The tick's pass: reads every repository that is due. A branch no open issue's latest agent is on is never read. */
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

    /**
     * The branch's pull request as GitHub has it now, for a move that cuts from origin: one gh call,
     * after every read still out, saved as the tick saves. why never the saved one: it is what GitHub
     * showed at an earlier minute, and the branch may have moved since, back included. why not wait
     * for the tick: a quiet repository is read every five minutes, and a regional manager told to
     * push and call again must not be refused meanwhile. `agent`: the one last on the branch.
     */
    readNow: (coordinatorId: CoordinatorId, agent: Agent, branch: string): Promise<PrRead> => serially(() => readOne(coordinatorId, agent, branch)),

    /**
     * The branch the pull request at `prUrl` is from, as GitHub has it now: one gh call, saving
     * nothing. null when the URL isn't a pull request of the regional manager's repository on
     * GitHub, or gh couldn't say. why its repository only: the watch reads pull requests there, by
     * branch.
     */
    async headBranchOf(coordinatorId: CoordinatorId, prUrl: string): Promise<string | null> {
      const named = parsePrUrl(prUrl);
      if (named === null) return null;
      try {
        const repo = await repoOf(coordinatorId);
        // why lower case: GitHub matches an owner and a name in any case.
        if (repo === null || named.repo.toLowerCase() !== repo.toLowerCase()) return null;
        return parsePrHead(await run("gh", prHeadQueryArgs(repo, named.number)));
      } catch {
        // why caught: bb can't say the project's remote, gh is missing, signed out or offline, or GitHub has no such pull request; the handoff keeps the branch it can name without it.
        return null;
      }
    },
  };
}

/**
 * Whether the watch reads the issue's pull request: an open issue of a kind that ships code, or one
 * the manager accepted while its parent is open. why that one: whether its work merged decides
 * whether its parent waits In review or is flagged (status.ts parentView), and a merge after the
 * accept clears the flag.
 */
function watches(issue: Issue, issues: readonly Issue[]): boolean {
  if (!shipsCode(issue.kind)) return false;
  if (issue.closed === null) return true;
  const parent = issues.find(({ id }) => id === issue.parentId);
  return issue.closed.as === "accepted" && parent !== undefined && parent.closed === null;
}
