// The Summary tab's Activity, under the description: the PR's comments, reviews, commits and events
// from the comments read, which the Changes tab and the guide share, and the composer at its foot.
// A failed read shows above the activity it leaves in place (REVIEW.md).
import { useId, useMemo } from "react";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import type { PrDetail } from "../../contract.ts";
import { useComments, type PrTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { activityOf } from "./activity-fold.ts";
import { ActivityTimeline } from "./activity-timeline.tsx";
import { ConversationComposer, useConversationComposer } from "./conversation-composer.tsx";

type ActivitySectionProps = { target: PrTarget; pr: PrDetail; onShowThread(thread: ReviewThread): void };

export function ActivitySection({ target, pr, onShowThread }: ActivitySectionProps) {
  const comments = useComments(target);
  const composer = useConversationComposer();
  const heading = useId();
  const days = useMemo(() => (comments.data === undefined ? null : activityOf(comments.data.timeline, comments.data.threads)), [comments.data]);
  const changedPaths = useMemo(() => new Set(comments.data?.changedPaths), [comments.data]);
  return (
    <section aria-labelledby={heading} className="grid grid-cols-[minmax(0,1fr)]">
      <h2 id={heading} className="text-[15px] leading-6 font-semibold text-foreground">
        Activity
      </h2>
      <ReadError read={comments} what="the activity" />
      {comments.isLoading && <Notice>Loading activity…</Notice>}
      {days !== null && <ActivityTimeline days={days} prAuthor={pr.author} changedPaths={changedPaths} onQuote={composer.quote} onShowThread={onShowThread} />}
      <div className="mt-6">
        <ConversationComposer head={{ ...target, headSha: pr.headSha }} composer={composer} />
      </div>
    </section>
  );
}
