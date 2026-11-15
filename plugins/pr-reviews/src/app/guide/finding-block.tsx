// A finding under its line in a step's diff, drawn as the review threads are (review-thread.tsx):
// a band across the diff, a 24px mark where a comment has its avatar, a line of the priority word
// and the title, and the body in a borderless bubble. Then its two actions, each selecting the
// finding's line and opening the diff's comment box under the finding: "Ask about this" empty, to
// ask the review thread about the finding, and "Comment" with the finding as the comment, to post
// on GitHub. The band draws only its bottom edge: the diff's note draws the top (pr-diff.tsx).
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { findingCommentText } from "../../comments/plan-comment.ts";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import { COMMENT_INDENT } from "../comments/github-comment.tsx";
import type { OpenBox } from "../diff/pr-diff.tsx";
import { Button } from "../ui/button.tsx";
import { Prose, READING_TYPE } from "../ui/prose.tsx";
import { Priority, PRIORITIES } from "./priority.tsx";

type FindingBlockProps = { shown: VisibleFinding; openBox: OpenBox };

export function FindingBlock({ shown: { finding, index }, openBox }: FindingBlockProps) {
  return (
    <section aria-label={`Finding: ${finding.title}`} className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-border bg-background px-3 pt-3 pb-2 text-sm leading-5">
      <div className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {/* The finding's mark, in its priority's colour, where a comment has its avatar. */}
        <span aria-hidden className="grid size-6 place-items-center rounded-full bg-muted">
          <Icon name="AlertCircle" className={`size-3.5 ${PRIORITIES[finding.priority].colour}`} />
        </span>
        <div className="flex min-h-6 min-w-0 items-center gap-1.5">
          <Priority priority={finding.priority} />
          <Prose text={finding.title} className="min-w-0 font-medium" />
        </div>
        <div className={`col-start-2 min-w-0 rounded-xl bg-surface-recessed px-3.5 py-2.5 ${READING_TYPE}`}>
          <Prose text={finding.body} />
        </div>
      </div>
      <div className={`${COMMENT_INDENT} -ml-3 flex flex-wrap items-center gap-1 px-3`}>
        <Button variant="ghost" size="sm" onClick={(event) => openBox({ finding: index, prefill: "", from: event.currentTarget })}>
          <Icon name="SideChat" aria-hidden />
          Ask about this
        </Button>
        <Button variant="ghost" size="sm" onClick={(event) => openBox({ finding: index, prefill: findingCommentText(finding), from: event.currentTarget })}>
          <Icon name="GithubLogo" aria-hidden />
          Comment
        </Button>
      </div>
    </section>
  );
}
