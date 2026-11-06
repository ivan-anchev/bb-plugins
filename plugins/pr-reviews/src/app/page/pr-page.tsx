// navPanel component: the chosen PR's page, its header above one screen per review state.
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { ReviewState } from "../../contract.ts";
import { usePullRequest } from "../queries.ts";
import { parseRoute } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { PrHeader } from "./pr-header.tsx";

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
          <ReviewScreen review={pull.data.review} />
        </>
      )}
    </div>
  );
}

function ReviewScreen({ review }: { review: ReviewState }) {
  switch (review.kind) {
    case "none":
      return <NoGuideYet />;
    default:
      return review.kind satisfies never;
  }
}

function NoGuideYet() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-7 pb-16">
      <h2 className="text-base font-semibold">No guide yet</h2>
    </div>
  );
}
