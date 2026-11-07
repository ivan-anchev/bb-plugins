// The PR page below its header while there is no guide: one screen per review state, each a
// heading, a line of context, and its actions.
import type { ReactNode } from "react";
import type { experimental_PluginRpcCallError as RpcCallError } from "@get-bb/plugin-sdk/app";
import type { ReviewState } from "../../contract.ts";
import { useReviewAction, type PrTarget } from "../queries.ts";
import { timeAgo } from "../relative-time.ts";
import { ReviewChatButton } from "../review-chat/review-chat-button.tsx";
import { Button } from "../ui/button.tsx";
import { useElapsed } from "./elapsed.ts";

type Running = Extract<ReviewState, { kind: "running" }>;
type NoGuide = Extract<ReviewState, { kind: "no-guide" }>;

export function NoneScreen({ target }: { target: PrTarget }) {
  const start = useReviewAction("startReview", target);
  return (
    <Screen
      title="No guide yet"
      error={start.error}
      actions={
        <Button variant="primary" disabled={start.isPending} onClick={start.run}>
          Start review
        </Button>
      }
    >
      Starts a review thread in a new worktree, with the instructions from Settings → PR Reviews. Nothing is posted to GitHub.
    </Screen>
  );
}

export function RunningScreen({ target, review }: { target: PrTarget; review: Running }) {
  const cancel = useReviewAction("cancelReview", target);
  const elapsed = useElapsed(review.startedAt);
  return (
    <Screen
      title={
        <>
          <Spinner />
          Writing the guide
        </>
      }
      error={cancel.error}
      actions={
        <>
          <ReviewChatButton variant="secondary" />
          <Button variant="ghost" disabled={cancel.isPending} onClick={cancel.run}>
            Cancel
          </Button>
        </>
      }
    >
      The review thread is reading the change and deciding how to walk you through it. <span className="tabular-nums">{elapsed} so far.</span>
    </Screen>
  );
}

export function NoGuideScreen({ target, review }: { target: PrTarget; review: NoGuide }) {
  const nudge = useReviewAction("nudgeReview", target);
  return (
    <Screen
      title="The review finished without a guide"
      error={nudge.error}
      actions={
        <>
          <Button variant="primary" disabled={nudge.isPending} onClick={nudge.run}>
            Ask it to submit the guide
          </Button>
          <ReviewChatButton variant="secondary" />
        </>
      }
    >
      The thread went idle {timeAgo(new Date(review.idleSince).toISOString(), Date.now())} without submitting one. Its last message may explain why.
    </Screen>
  );
}

type ScreenProps = { title: ReactNode; error: RpcCallError | null; actions: ReactNode; children: ReactNode };

function Screen({ title, error, actions, children }: ScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto px-7 pb-16">
      <section className="m-auto grid w-full max-w-[440px] justify-items-start gap-3 p-6">
        <h2 className="flex items-center gap-2.5 text-base font-semibold">{title}</h2>
        <p className="text-[13px] leading-5 text-muted-foreground">{children}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">{actions}</div>
        {error !== null && (
          <p role="alert" className="text-xs text-destructive">
            {error.message}
          </p>
        )}
      </section>
    </div>
  );
}

function Spinner() {
  return <span aria-hidden className="inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent motion-reduce:animate-none" />;
}
