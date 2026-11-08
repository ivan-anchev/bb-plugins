// headerContent: one Refresh for the whole screen. It mounts the route's reads with the same
// method and input as the sidebar and the page, so it shares their cache entries, and
// refetch() re-reads each one regardless of freshness or a cached failure (REVIEW.md).
import type { ExperimentalRpcQueryState, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { guideHeadShaOf } from "../../contract.ts";
import { useChangesToReread, useGuide, useProjects, usePullRequest, usePullRequests, type GuideTarget } from "../queries.ts";
import { parseRoute } from "../routes.ts";
import { IconButton } from "../ui/icon-button.tsx";

export function RefreshButton({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  switch (route.kind) {
    case "root":
      return <RefreshProjects />;
    case "project":
      return <RefreshProject projectId={route.projectId} />;
    case "pr":
      return <RefreshPr projectId={route.projectId} number={route.number} />;
    default:
      route satisfies never;
      return null;
  }
}

const RefreshProjects = () => <RefreshReads reads={[useProjects()]} />;

const RefreshProject = ({ projectId }: { projectId: string }) => <RefreshReads reads={[useProjects(), usePullRequests(projectId)]} />;

// A PR page also re-reads its diff once the Changes tab has read it, and its guide when it shows one.
function RefreshPr({ projectId, number }: { projectId: string; number: number }) {
  const pull = usePullRequest(projectId, number);
  const reads = [useProjects(), usePullRequests(projectId), pull, ...useChangesToReread({ projectId, number })];
  const headSha = pull.data === undefined ? null : guideHeadShaOf(pull.data.review);
  return headSha === null ? <RefreshReads reads={reads} /> : <RefreshWithGuide reads={reads} guide={{ projectId, number, headSha }} />;
}

const RefreshWithGuide = ({ reads, guide }: { reads: Read[]; guide: GuideTarget }) => <RefreshReads reads={[...reads, useGuide(guide)]} />;

type Read = Pick<ExperimentalRpcQueryState<unknown>, "isFetching" | "refetch">;

function RefreshReads({ reads }: { reads: Read[] }) {
  const busy = reads.some((read) => read.isFetching);
  return <IconButton icon="RotateCcw" label="Refresh" disabled={busy} onClick={() => void Promise.all(reads.map((read) => read.refetch()))} />;
}
