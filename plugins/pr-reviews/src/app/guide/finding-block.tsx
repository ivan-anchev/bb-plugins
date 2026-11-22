import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { findingCommentText } from "../../comments/plan-comment.ts";
import { pickForNextBox } from "../comments/send-as.tsx";
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
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            pickForNextBox("ask");
            openBox({ finding: index, prefill: "", from: event.currentTarget });
          }}
        >
          <Icon name="SideChat" aria-hidden />
          Ask about this
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            pickForNextBox("github");
            openBox({ finding: index, prefill: findingCommentText(finding), from: event.currentTarget });
          }}
        >
          <Icon name="GithubLogo" aria-hidden />
          Comment
        </Button>
      </div>
    </section>
  );
}
