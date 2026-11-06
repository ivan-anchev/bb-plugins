// The rail badge: how many open PRs of the remembered project have a guide for their current
// head. The same pullRequests read the sidebar makes, so it costs no extra gh call and updates
// on the same invalidations.
import type { ExperimentalBadge } from "@get-bb/plugin-sdk/app";
import { useProjects, usePullRequests } from "./queries.ts";

export function useReadyGuidesBadge(): ExperimentalBadge | null {
  const projects = useProjects();
  const pulls = usePullRequests(projects.data?.selectedProjectId ?? null);
  const ready = pulls.data?.rows.filter((row) => row.review.kind === "ready").length ?? 0;
  return ready === 0 ? null : { count: ready, label: `${ready} ${ready === 1 ? "guide" : "guides"} ready` };
}
