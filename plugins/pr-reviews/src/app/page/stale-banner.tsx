import { commitsSince, type PrDetail } from "../../contract.ts";
import { useReviewAction, type PrTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";

type StaleBannerProps = { target: PrTarget; pr: PrDetail; guideHeadSha: string };

export function StaleBanner({ target, pr, guideHeadSha }: StaleBannerProps) {
  const update = useReviewAction("updateGuide", target);
  return (
    <div className="mx-6 mt-3 mb-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-sm">
      <p role="status" className="min-w-0 flex-1">
        {sinceGuide(commitsSince(pr, guideHeadSha))}
      </p>
      {update.error !== null && (
        <p role="alert" className="text-xs text-destructive-text">
          {update.error.message}
        </p>
      )}
      <Button variant="secondary" size="sm" disabled={update.isPending} onClick={update.run}>
        Update guide
      </Button>
    </div>
  );
}

function sinceGuide(newCommits: number | null): string {
  if (newCommits === null) return "The PR changed since this guide was written.";
  return `${newCommits} new commit${newCommits === 1 ? "" : "s"} since this guide was written.`;
}
