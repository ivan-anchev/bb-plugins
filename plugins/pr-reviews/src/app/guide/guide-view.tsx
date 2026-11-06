// The PR page below its header once a guide exists: for now the overview's problem and
// approach, and who wrote it for which commit.
import type { GuideRecord } from "../../contract.ts";
import { useGuide, type GuideTarget } from "../queries.ts";
import { timeAgo } from "../relative-time.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";

export function GuideView({ target }: { target: GuideTarget }) {
  const guide = useGuide(target);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ReadError read={guide} what="the guide" />
      {guide.isLoading && <Notice>Loading the guide…</Notice>}
      {guide.data !== undefined && <Overview record={guide.data.record} />}
    </div>
  );
}

function Overview({ record }: { record: GuideRecord }) {
  const { problem, approach } = record.guide.overview;
  return (
    <article className="grid max-w-[880px] content-start gap-[18px] px-7 pt-[18px] pb-10">
      <h2 className="text-[21px] font-semibold leading-7 tracking-[-0.01em] text-balance">What this PR does</h2>
      <p className="max-w-[68ch] text-sm leading-[22px]">{problem}</p>
      <p className="max-w-[68ch] text-sm leading-[22px]">{approach}</p>
      <Byline record={record} />
    </article>
  );
}

function Byline({ record }: { record: GuideRecord }) {
  const submittedAt = new Date(record.submittedAt).toISOString();
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      Written by {record.model ?? "the review thread"} for <code className="font-mono">{record.key.headSha.slice(0, 7)}</code>,{" "}
      <time dateTime={submittedAt} title={new Date(record.submittedAt).toLocaleString()}>
        {timeAgo(submittedAt, Date.now())}
      </time>
    </p>
  );
}
