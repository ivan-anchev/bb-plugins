import { useCallback, useRef, useState, type RefObject } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { reviewThreadOf, type PrDetail, type ReviewState } from "../../contract.ts";
import type { Repo } from "../../github/repo.ts";
import { ChangesTab } from "../changes/changes-tab.tsx";
import type { ThreadReveal } from "../changes/thread-reveal.ts";
import { usePullRequest, useRecordVisit, type PrTarget } from "../queries.ts";
import { GuideView } from "../guide/guide-view.tsx";
import { GuideViewOptions, useViewOptions, type ViewOptionsState } from "../guide/view-options.tsx";
import { parseRoute } from "../routes.ts";
import { Button } from "../ui/button.tsx";
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
  return <PullRequestPage key={`${route.projectId}/${route.number}`} projectId={route.projectId} number={route.number} />;
}

function PullRequestPage({ projectId, number }: { projectId: string; number: number }) {
  const pull = usePullRequest(projectId, number);
  const visit = useRecordVisit({ projectId, number });
  const viewOptions = useViewOptions();
  const page = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const focusPage = useCallback(() => (title.current ?? page.current)?.focus(), []);
  return (
    <div ref={page} tabIndex={-1} className="flex h-full min-h-0 flex-col bg-background text-foreground outline-none">
      <ReadError read={pull} what="this pull request" />
      <VisitError visit={visit} onLeaveWithFocus={focusPage} />
      {pull.isLoading && <Notice>Loading pull request…</Notice>}
      {pull.data !== undefined && <ReviewPage target={{ projectId, number }} repo={pull.data.repo} pr={pull.data.pr} review={pull.data.review} viewOptions={viewOptions} title={title} />}
    </div>
  );
}

function VisitError({ visit, onLeaveWithFocus }: { visit: ReturnType<typeof useRecordVisit>; onLeaveWithFocus(): void }) {
  const notice = useCallback(
    (region: HTMLElement | null) => {
      if (region === null) return;
      return () => {
        if (region.contains(document.activeElement)) onLeaveWithFocus();
      };
    },
    [onLeaveWithFocus],
  );
  return visit.error === null ? null : (
    <div ref={notice}>
      <Notice tone="error">
        Could not record that you opened this pull request: {visit.error.message}{" "}
        <Button variant="outline" size="sm" aria-disabled={visit.isPending} onClick={visit.isPending ? undefined : visit.retry}>
          Try again
        </Button>
      </Notice>
    </div>
  );
}

type ReviewPageProps = { target: PrTarget; repo: Repo; pr: PrDetail; review: ReviewState; viewOptions: ViewOptionsState; title: RefObject<HTMLHeadingElement | null> };

function ReviewPage({ target, repo, pr, review, viewOptions, title }: ReviewPageProps) {
  const [tab, setTab] = useState<PrTab>("summary");
  const [reveal, setReveal] = useState<ThreadReveal | null>(null);
  const asks = useRef(0);
  const showThread = (thread: ReviewThread) => {
    asks.current += 1;
    setReveal({ path: thread.path, threadId: thread.id, asked: asks.current });
    setTab("changes");
  };
  const onRevealed = useCallback(() => setReveal(null), []);
  return (
    <>
      <PrHeader target={target} repo={repo} pr={pr} hasReviewThread={reviewThreadOf(review) !== null} title={title} />
      <PrTabs
        selected={tab}
        onSelect={setTab}
        tabs={{
          summary: { status: { kind: "none" }, panel: <SummaryTab target={target} pr={pr} onShowThread={showThread} />, barEnd: null },
          changes: {
            status: { kind: "lines", added: pr.additions, removed: pr.deletions },
            panel: <ChangesTab target={target} shown={tab === "changes"} reveal={reveal} onRevealed={onRevealed} />,
            barEnd: null,
          },
          guide: guideTabOf(target, pr, review, viewOptions, tab === "guide"),
        }}
      />
    </>
  );
}

function guideTabOf(target: PrTarget, pr: PrDetail, review: ReviewState, viewOptions: ViewOptionsState, shown: boolean): TabContent {
  switch (review.kind) {
    case "none":
      return { status: { kind: "none" }, panel: <NoneScreen target={target} />, barEnd: null };
    case "running":
      return { status: { kind: "writing" }, panel: <RunningScreen target={target} review={review} />, barEnd: null };
    case "no-guide":
      return { status: { kind: "none" }, panel: <NoGuideScreen target={target} review={review} />, barEnd: null };
    case "ready":
    case "stale": {
      const head = { ...target, headSha: review.guideHeadSha };
      return {
        status: { kind: "ready" },
        panel: (
          <>
            {review.kind === "stale" && <StaleBanner target={target} pr={pr} guideHeadSha={review.guideHeadSha} />}
            <GuideView key={review.guideHeadSha} head={head} viewOptions={viewOptions} shown={shown} />
          </>
        ),
        barEnd: <GuideViewOptions head={head} viewOptions={viewOptions} />,
      };
    }
    default:
      return review satisfies never;
  }
}
