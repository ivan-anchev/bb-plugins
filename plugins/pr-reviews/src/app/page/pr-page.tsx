// navPanel component: the chosen PR's page, its header above the Summary and Guide tabs. The Guide
// tab shows one screen per review state.
import { useState } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { reviewThreadOf, type PrDetail, type ReviewState } from "../../contract.ts";
import { usePullRequest, type PrTarget } from "../queries.ts";
import { GuideView } from "../guide/guide-view.tsx";
import { GuideViewOptions, useViewOptions, type ViewOptionsState } from "../guide/view-options.tsx";
import { parseRoute } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { PrHeader } from "./pr-header.tsx";
import { PrTabs, type PrTab, type TabContent } from "./pr-tabs.tsx";
import { NoGuideScreen, NoneScreen, RunningScreen } from "./review-screens.tsx";
import { StaleBanner } from "./stale-banner.tsx";
import { SummaryTab } from "./summary-tab.tsx";

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

type ReviewPageProps = { target: PrTarget; pr: PrDetail; review: ReviewState; viewOptions: ViewOptionsState };

// One header and one tab bar for every review state, so their buttons keep keyboard focus while the
// state changes. A PR opens on Summary: the page is keyed by PR, so the tab is too.
function ReviewPage({ target, pr, review, viewOptions }: ReviewPageProps) {
  const [tab, setTab] = useState<PrTab>("summary");
  return (
    <>
      <PrHeader pr={pr} hasReviewThread={reviewThreadOf(review) !== null} />
      <PrTabs
        selected={tab}
        onSelect={setTab}
        tabs={{
          summary: { status: "none", panel: <SummaryTab pr={pr} />, barEnd: null },
          guide: guideTabOf(target, pr, review, viewOptions, tab === "guide"),
        }}
      />
    </>
  );
}

/** The Guide tab for a review state: its screen, its status, and the view options once there is a guide. */
function guideTabOf(target: PrTarget, pr: PrDetail, review: ReviewState, viewOptions: ViewOptionsState, shown: boolean): TabContent {
  switch (review.kind) {
    case "none":
      return { status: "none", panel: <NoneScreen target={target} />, barEnd: null };
    case "running":
      return { status: "writing", panel: <RunningScreen target={target} review={review} />, barEnd: null };
    case "no-guide":
      return { status: "none", panel: <NoGuideScreen target={target} review={review} />, barEnd: null };
    // A stale guide is still worth reading: it shows under a banner offering Update guide.
    case "ready":
    case "stale": {
      const guide = { ...target, headSha: review.guideHeadSha };
      return {
        status: "ready",
        panel: (
          <>
            {review.kind === "stale" && <StaleBanner target={target} pr={pr} guideHeadSha={review.guideHeadSha} />}
            {/* Keyed: a new guide is a new view. */}
            <GuideView key={review.guideHeadSha} target={guide} viewOptions={viewOptions} shown={shown} />
          </>
        ),
        barEnd: <GuideViewOptions target={guide} viewOptions={viewOptions} />,
      };
    }
    default:
      return review satisfies never;
  }
}
