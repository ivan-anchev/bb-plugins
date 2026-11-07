// navPanel component: the chosen PR's page, its header above one screen per review state.
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { ReviewState } from "../../contract.ts";
import { usePullRequest } from "../queries.ts";
import { GuideView } from "../guide/guide-view.tsx";
import { parseRoute } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { PrHeader } from "./pr-header.tsx";
import { NoGuideScreen, NoneScreen, RunningScreen, type PrTarget } from "./review-screens.tsx";

export function PrPage({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  if (route.kind !== "pr") return <Notice>Choose a pull request.</Notice>;
  // Keyed: a different PR is a different page.
  return <PullRequestPage key={`${route.projectId}/${route.number}`} projectId={route.projectId} number={route.number} />;
}

function PullRequestPage({ projectId, number }: { projectId: string; number: number }) {
  const pull = usePullRequest(projectId, number);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ReadError read={pull} what="this pull request" />
      {pull.isLoading && <Notice>Loading pull request…</Notice>}
      {pull.data !== undefined && (
        <>
          <PrHeader pr={pull.data.pr} />
          <ReviewScreen target={{ projectId, number }} review={pull.data.review} />
        </>
      )}
    </div>
  );
}

function ReviewScreen({ target, review }: { target: PrTarget; review: ReviewState }) {
  switch (review.kind) {
    case "none":
      return <NoneScreen target={target} />;
    case "running":
      return <RunningScreen target={target} review={review} />;
    case "no-guide":
      return <NoGuideScreen target={target} review={review} />;
    // Stale shows its guide too; its banner and Update guide are not built yet.
    case "ready":
    case "stale":
      // Keyed: a new guide is a new view.
      return <GuideView key={review.guideHeadSha} target={{ ...target, headSha: review.guideHeadSha }} />;
    default:
      return review satisfies never;
  }
}
