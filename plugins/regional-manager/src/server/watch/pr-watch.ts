// Pull requests, merge requests and CI, which bb never pushes: on the one-minute tick, the watch
// reads the change request of every open issue's branch (its latest agent's with one) from its
// project's forge, GitHub through gh or GitLab through glab (locate.ts), and of a sub-issue
// accepted unmerged while its parent is open (watches), once per branch, one read per project
// (a gh call, or a glab call per five branches), whether or not that agent's thread is still live: an
// issue In review whose agent's thread was archived still becomes Done when its pull request
// merges. It saves each successful read and records a `pr` event when one changed meaningfully; the
// verify step's pass, after it in the same tick, settles the verdicts that wait for CI. A failed
// read keeps what was saved and says why on the board. A handover that moves work through origin
// also reads one branch at once (readNow), saved the same way.
import { issueBranch, type Agent } from "../../model/agent/agent.ts";
import type { Issue } from "../../model/issue/issue.ts";
import { shipsCode } from "../../model/issue/kind.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { ciRunning, type BranchesRead, type PrRead } from "../../model/verdict/pr.ts";
import { threadsById } from "../agents/threads.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store/store.ts";
import { parsePrHead, parsePrUrl, prHeadQueryArgs, readGitHub } from "./github/pr-query.ts";
import { readGitLab } from "./gitlab/merge-requests.ts";
import type { RunCli } from "./host-command.ts";
import { createLocator, type ForgeRepo, type Located } from "./locate.ts";

/** How often a project with no CI running and no verdict waiting for it is read. */
const QUIET_POLL_MS = 5 * 60_000;

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

/** A branch the watch reads: its regional manager, the agent last on it, and where its project is (or why it can't be read). */
type Watched = { coordinatorId: CoordinatorId; agent: Agent; branch: string; located: Located };

export type PrWatch = ReturnType<typeof createPrWatch>;

export function createPrWatch({ bb, store, inbox, run, now }: Deps) {
  const locator = createLocator(run);
  // why: a tick that outlasts the minute must not overlap the next, or one read could save over a newer one.
  let running = false;
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });
  // The latest read asked for, the tick's or a move's, settled once it and every one before it are.
  // why one at a time: a read saves what the forge said as it began, so one that overlapped a later one
  // could save an older head over a newer.
  let reads: Promise<unknown> = Promise.resolve();
  function serially<T>(read: () => Promise<T>): Promise<T> {
    const next = reads.then(read, read);
    reads = next.catch(() => {});
    return next;
  }

  /** Where a regional manager's project is, as its git remote says now. */
  async function locatedOf(coordinatorId: CoordinatorId): Promise<Located> {
    const coordinator = store.coordinator(coordinatorId);
    // why throw: a move reads the pull request of its own regional manager's issue.
    if (coordinator === null) throw new Error(`No regional manager ${coordinatorId}.`);
    const { gitRemoteUrl } = await bb.sdk.projects.get({ projectId: coordinator.projectId });
    return locator.locate(gitRemoteUrl);
  }

  /**
   * Every open issue's branch (issueBranch), of a kind that ships code, whose change request may
   * still change, once per branch, grouped by project (groupKey).
   */
  async function watched(): Promise<Map<string, Watched[]>> {
    const groups = new Map<string, Watched[]>();
    for (const coordinator of store.coordinators()) {
      const issues = store.issues(coordinator.id);
      const open = issues.filter((issue) => watches(issue, issues));
      const agents = store.agents(coordinator.id).filter((agent) => open.some((issue) => issue.id === agent.issueId));
      if (agents.length === 0) continue;
      const located = await locatedOf(coordinator.id);
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
        const key = groupKey(coordinator.id, located);
        groups.set(key, [...(groups.get(key) ?? []), { coordinatorId: coordinator.id, agent, branch, located }]);
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

  /**
   * One read of every branch of the project, by its forge: the change request of each (null: none),
   * or why it failed. A GitLab read that failed forgets its host's sign-in, so the next locate asks
   * glab again.
   */
  async function read(repo: ForgeRepo, branches: readonly string[]): Promise<BranchesRead> {
    switch (repo.forge) {
      case "github":
        return readGitHub(run, repo.path, branches);
      case "gitlab": {
        const result = await readGitLab(run, repo, branches);
        if (result.kind === "unavailable") locator.forget(repo.host);
        return result;
      }
      default:
        return repo satisfies never;
    }
  }

  /**
   * Reads the project's branches and saves what each read found, as of each agent's latest handoff
   * when the read began. A project off every forge the plugin reads is marked with why on every
   * branch, so the board says so; one with no git remote only when a verdict waits on its CI,
   * which then can't be checked.
   */
  async function poll(branches: readonly Watched[], now: number): Promise<void> {
    const [first] = branches;
    if (first === undefined) return;
    const { located } = first;
    // why before the CLI runs: a handoff made while it runs came after what it answers.
    const reading = branches.map((watched) => ({ ...watched, handoffAtRead: latestHandoffOf(watched.agent) }));
    const result: BranchesRead = located.kind === "on-forge" ? await read(located.repo, [...new Set(branches.map(({ branch }) => branch))]) : { kind: "unavailable", unavailable: located.unavailable };
    for (const { coordinatorId, agent, branch, handoffAtRead } of reading) {
      if (disposed) return;
      // why read the issues again: the regional manager may have closed the issue, or its parent, while the CLI ran.
      const issue = store.issue(coordinatorId, agent.issueId);
      if (issue === null || !watches(issue, store.issues(coordinatorId))) continue;
      // why no remote only when a verdict waits: a project with nothing to read stays quiet until CI is asked of it.
      if (located.kind === "no-remote" && store.waitingForCi(coordinatorId, agent.id).length === 0) continue;
      if (result.kind === "read") inbox.prRead(coordinatorId, branch, { issueId: agent.issueId, agentId: agent.id }, result.prs.get(branch) ?? null, handoffAtRead, now);
      else inbox.prUnavailable(coordinatorId, branch, result.unavailable, now);
    }
  }

  /** Reads the branch's change request now and saves what the read found as the tick does, `agent` being the one last on it. */
  async function readOne(coordinatorId: CoordinatorId, agent: Agent, branch: string): Promise<PrRead> {
    const located = await locatedOf(coordinatorId);
    if (located.kind !== "on-forge") return { kind: "unread", reason: located.unavailable.reason };
    const handoffAtRead = latestHandoffOf(agent);
    const result = await read(located.repo, [branch]);
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
     * The branch's change request as its forge has it now, for a move that cuts from origin: one
     * read, after every read still out, saved as the tick saves. why never the saved one: it is what the forge
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
        const located = await locatedOf(coordinatorId);
        // why GitHub only: a GitLab done handoff on a detached HEAD keeps the branch otherwise known. why lower case: GitHub matches an owner and a name in any case.
        if (located.kind !== "on-forge" || located.repo.forge !== "github" || named.repo.toLowerCase() !== located.repo.path.toLowerCase()) return null;
        return parsePrHead(await run("gh", prHeadQueryArgs(located.repo.path, named.number)));
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

/**
 * The group a branch is read in: its forge, host and project path, so one read covers every
 * manager on that project; or its manager, off every forge the plugin reads, as each such manager's
 * reason is its own. why lower case: both forges match a path in any case, so two spellings are one
 * project.
 */
function groupKey(coordinatorId: CoordinatorId, located: Located): string {
  switch (located.kind) {
    case "on-forge":
      return `${located.repo.forge}:${located.repo.host}:${located.repo.path.toLowerCase()}`;
    case "off-forge":
    case "no-remote":
      return `off:${coordinatorId}`;
    default:
      return located satisfies never;
  }
}
