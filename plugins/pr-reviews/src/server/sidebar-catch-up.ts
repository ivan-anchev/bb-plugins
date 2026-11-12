// After a state change: the sidebar reads GitHub's search, which can list a changed PR in its old
// state for a few seconds. This re-reads the sidebar until it shows the PR in its new state, then
// has the app re-read it; it gives up after a bounded number of reads. The plugin instance owns
// it: dispose cancels every pending read, and nothing starts after.
import type { InboxPr, PrState, StateChange } from "../contract.ts";
import { repoKey, type Repo } from "../github/repo.ts";

// GitHub's search listed a reopened PR as open 5 s after `gh pr reopen` returned (measured on a
// throwaway repo); six reads 3 s apart wait more than three times that.
const READ_EVERY_MS = 3_000;
const MAX_READS = 6;

const STATES_AFTER: Record<StateChange, readonly PrState[]> = {
  ready: ["OPEN"],
  draft: ["DRAFT"],
  close: ["CLOSED"],
  // A PR closed as a draft reopens as one.
  reopen: ["OPEN", "DRAFT"],
};

type Deps = {
  /** Every PR the sidebar shows, read from GitHub now. */
  readListed: () => Promise<InboxPr[]>;
  /** Has the app re-read the sidebar. */
  invalidate: () => void;
};

export type SidebarCatchUp = {
  /** Starts following one change of `number` in `repo` in the background. */
  follow(repo: Repo, number: number, change: StateChange): void;
  dispose(): void;
};

export function createSidebarCatchUp({ readListed, invalidate }: Deps): SidebarCatchUp {
  const disposed = new AbortController();
  const { signal } = disposed;

  async function catchUp(shows: (pr: InboxPr) => boolean): Promise<void> {
    for (let read = 0; read < MAX_READS; read++) {
      await pause(READ_EVERY_MS, signal);
      if (signal.aborted) return;
      // A failed read reads as not caught up yet: the next one tries again.
      const listed = await readListed().catch((): InboxPr[] => []);
      if (signal.aborted) return;
      if (listed.some(shows)) return invalidate();
    }
  }

  return {
    follow(repo, number, change) {
      void catchUp((pr) => repoKey(pr.repo) === repoKey(repo) && pr.number === number && STATES_AFTER[change].includes(pr.state));
    },
    dispose: () => disposed.abort(),
  };
}

// Resolves after `ms`, or at once when `signal` aborts.
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
