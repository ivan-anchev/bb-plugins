// Above a stale guide: how far the PR has moved past it, and Update guide.
import { commitsSince, type PrDetail } from "../../contract.ts";
import { useReviewAction, type PrTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";

type StaleBannerProps = { target: PrTarget; pr: PrDetail; guideHeadSha: string };

export function StaleBanner({ target, pr, guideHeadSha }: StaleBannerProps) {
  const update = useReviewAction("updateGuide", target);
  return (
    // why the arbitrary value: bb's theme has a warning text colour but no Tailwind utility for it.
    <div className="mx-7 mb-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-[color-mix(in_oklch,var(--warning-text)_10%,transparent)] px-3 py-2 text-[13px]">
      <p role="status" className="min-w-0 flex-1">
        {sinceGuide(commitsSince(pr, guideHeadSha))}
      </p>
      {update.error !== null && (
        <p role="alert" className="text-xs text-destructive-text">
          {update.error.message}
        </p>
      )}
      <Button variant="secondary" size="small" disabled={update.isPending} onClick={update.run}>
        Update guide
      </Button>
    </div>
  );
}

// A null count means a force push removed the guide's commit from the PR.
function sinceGuide(newCommits: number | null): string {
  if (newCommits === null) return "The PR changed since this guide was written.";
  return `${newCommits} new commit${newCommits === 1 ? "" : "s"} since this guide was written.`;
}
