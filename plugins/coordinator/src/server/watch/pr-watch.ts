// Pull requests and CI, which bb never pushes: on the one-minute tick, the watch reads every open,
// started crew's pull request from GitHub by its branch, one `gh api graphql` call per repository.
// It saves each successful read and records a `pr` event when one changed meaningfully; the verify
// step's pass, after it in the same tick, settles the verdicts that wait for CI. A failed read keeps
// what was saved and says why on the board.
import { branchOf, type Crew } from "../../model/crew.ts";
import { ciRunning, type PrSnapshot, type PrUnavailable } from "../../model/verdict/pr.ts";
import { isOpen, listedThreads } from "../crew/board/board.ts";
import type { Inbox } from "../inbox/inbox.ts";
import type { Store } from "../store.ts";
import { ghFailure, UNREADABLE_ANSWER } from "./gh-failure.ts";
import { parseHostCommandFailure } from "./host-command.ts";
import { parseGitHubRepo, parsePrs, prQueryArgs, type Repo } from "./pr-query.ts";

/** How often a repository with no CI running and no verdict waiting for it is read. */
const QUIET_POLL_MS = 5 * 60_000;

/** Why a crew whose project has no GitHub remote has no pull request the plugin can read. */
const NOT_ON_GITHUB: PrUnavailable = { kind: "persistent", reason: "its project's git remote isn't on github.com" };

/** A crew's thread as the watch reads it. */
type ListedThread = { id: string; environmentBranchName: string | null; archivedAt: number | null; deletedAt: number | null };

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
  store: Pick<Store, "coordinators" | "crews" | "crew" | "prStatus" | "waitingForCi" | "latestHandoff">;
  inbox: Pick<Inbox, "prRead" | "prUnavailable">;
  /** Runs gh with these arguments and resolves to its stdout; rejects as Node's execFile does. */
  gh(args: string[]): Promise<string>;
};

type OpenCrew = Crew & { launch: { kind: "started" } };

/** An open crew the watch can read: its branch, in a repository on GitHub (null: its project's remote isn't). */
type Watched = { crew: OpenCrew; branch: string; repo: Repo | null };

export function createPrWatch({ bb, store, inbox, gh }: Deps) {
  // why: a tick that outlasts the minute must not overlap the next, or one read could save over a newer one.
  let running = false;
  let disposed = false;
  bb.onDispose(() => {
    disposed = true;
  });

  /**
   * Every open, started crew with a branch whose pull request may still change, grouped by
   * repository; a null key holds those not on GitHub.
   */
  async function watched(): Promise<Map<string | null, Watched[]>> {
    const groups = new Map<string | null, Watched[]>();
    for (const coordinator of store.coordinators()) {
      const crews = store.crews(coordinator.id).filter(isOpen).filter((crew) => !finished(crew));
      if (crews.length === 0) continue;
      const { gitRemoteUrl } = await bb.sdk.projects.get({ projectId: coordinator.projectId });
      const repo = gitRemoteUrl === null ? null : parseGitHubRepo(gitRemoteUrl);
      const threads = await listedThreads(bb, crews.map((crew) => crew.launch.threadId));
      for (const crew of crews) {
        const thread = threads.get(crew.launch.threadId);
        const branch = thread === undefined ? null : branchOf(crew, thread);
        if (branch === null) continue;
        // why lower case: GitHub matches an owner and a name in any case, so two spellings are one repository.
        const key = repo?.toLowerCase() ?? null;
        groups.set(key, [...(groups.get(key) ?? []), { crew, branch, repo }]);
      }
    }
    return groups;
  }

  /**
   * Whether a read found the crew's pull request merged or closed, and the crew hasn't handed off
   * since. why not read it again: a finished pull request has nothing left to wait for, and the
   * crew's next handoff, which comes with any pull request it reopens or opens, makes it due again.
   */
  function finished(crew: Crew): boolean {
    const status = store.prStatus(crew.coordinatorId, crew.id);
    if (status === null || status.snapshot === null || status.snapshot.state === "open") return false;
    return status.handoffAtRead === (store.latestHandoff(crew.coordinatorId, crew.id)?.id ?? null);
  }

  /** Whether a repository's crews are due a read: one never read, CI running, a verdict waiting for CI, or the quiet interval passed. */
  function due(crews: readonly Watched[], now: number): boolean {
    return crews.some(({ crew }) => {
      const status = store.prStatus(crew.coordinatorId, crew.id);
      if (status === null || store.waitingForCi(crew.coordinatorId, crew.id).length > 0) return true;
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
   * Reads the repository's crews and saves what each read found, as of each crew's latest handoff
   * when the read began. Crews not on GitHub are only marked when a verdict waits on their CI,
   * which then can't be checked.
   */
  async function poll(crews: readonly Watched[], now: number): Promise<void> {
    const repo = crews[0]?.repo ?? null;
    // why before gh runs: a handoff made while it runs came after what it answers.
    const reading = crews.map((watched) => ({ ...watched, handoffAtRead: store.latestHandoff(watched.crew.coordinatorId, watched.crew.id)?.id ?? null }));
    const result = repo === null ? null : await read(repo, [...new Set(crews.map(({ branch }) => branch))]);
    for (const { crew, branch, handoffAtRead } of reading) {
      if (disposed) return;
      // why read the crew again: it may have closed while gh ran.
      const current = store.crew(crew.coordinatorId, crew.id);
      if (current === null || !isOpen(current)) continue;
      if (result === null) {
        if (store.waitingForCi(crew.coordinatorId, crew.id).length === 0) continue;
        inbox.prUnavailable(crew.coordinatorId, crew.id, NOT_ON_GITHUB, now);
      } else if (result.kind === "read") inbox.prRead(crew.coordinatorId, crew.id, result.prs.get(branch) ?? null, handoffAtRead, now);
      else inbox.prUnavailable(crew.coordinatorId, crew.id, result.unavailable, now);
    }
  }

  return {
    /** The tick's pass: reads every repository that is due. A crew nobody watches any more is never read. */
    async tick(now: number): Promise<void> {
      if (disposed || running) return;
      running = true;
      try {
        for (const crews of (await watched()).values()) {
          if (disposed) return;
          if (due(crews, now)) await poll(crews, now);
        }
      } finally {
        running = false;
      }
    },
  };
}
