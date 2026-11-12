// The rail badge: how many open PRs of the project of the PR page last opened have a guide for
// their current head. It updates on the same invalidations as that project's PR reads.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";
import { lastOpenedProject } from "./last-opened.ts";
import { usePullRequests, useVisits } from "./queries.ts";

export function useReadyGuidesBadge(): ExperimentalBadge | null {
  const visits = useVisits();
  const pulls = usePullRequests(lastOpenedProject(visits.data?.visits ?? []));
  const ready = pulls.data?.rows.filter((row) => row.review.kind === "ready").length ?? 0;
  return ready === 0 ? null : { count: ready, label: `${ready} ${ready === 1 ? "guide" : "guides"} ready` };
}
