// navPanel component: the chosen PR's page, its header above one screen per review state.
import type { ReactNode } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { PrDetail, ReviewState } from "../../contract.ts";
import { usePullRequest } from "../queries.ts";
import { GuideView } from "../guide/guide-view.tsx";
import { GuideViewOptions, useViewOptions, type ViewOptionsState } from "../guide/view-options.tsx";
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
  const viewOptions = useViewOptions();
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <ReadError read={pull} what="this pull request" />
      {pull.isLoading && <Notice>Loading pull request…</Notice>}
      {pull.data !== undefined && <ReviewPage target={{ projectId, number }} pr={pull.data.pr} review={pull.data.review} viewOptions={viewOptions} />}
    </div>
  );
}

// Every state but "none" has a review thread.
const reviewThreadOf = (review: ReviewState) => (review.kind === "none" ? null : review.threadId);

type ReviewPageProps = { target: PrTarget; pr: PrDetail; review: ReviewState; viewOptions: ViewOptionsState };

// One header for every review state, so its buttons keep keyboard focus while the state changes.
function ReviewPage({ target, pr, review, viewOptions }: ReviewPageProps) {
  const screen = screenOf(target, pr, review, viewOptions);
  return (
    <>
      <PrHeader pr={pr} threadId={reviewThreadOf(review)}>
        {screen.actions}
      </PrHeader>
      {screen.body}
    </>
  );
}

/** A review state's page under the header, and its own actions in the header. */
type Screen = { actions: ReactNode; body: ReactNode };

function screenOf(target: PrTarget, pr: PrDetail, review: ReviewState, viewOptions: ViewOptionsState): Screen {
  switch (review.kind) {
    case "none":
      return { actions: null, body: <NoneScreen target={target} /> };
    case "running":
      return { actions: null, body: <RunningScreen target={target} review={review} /> };
    case "no-guide":
      return { actions: null, body: <NoGuideScreen target={target} review={review} /> };
    // Stale shows its guide too; its banner and Update guide are not built yet.
    case "ready":
    case "stale": {
      const guide = { ...target, headSha: review.guideHeadSha };
      return {
        actions: <GuideViewOptions target={guide} viewOptions={viewOptions} />,
        // Keyed: a new guide is a new view.
        body: <GuideView key={review.guideHeadSha} target={guide} pr={pr} viewOptions={viewOptions} />,
      };
    }
    default:
      return review satisfies never;
  }
}
