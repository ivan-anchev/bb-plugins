// A finding under its line in a step's diff: the priority word, the title and the body, then its
// two actions. Each selects the finding's line and opens the diff's comment box under the
// finding, on the Send as mode it names: "Ask about this" empty, on Ask, to ask the review thread
// about the finding, and "Comment" with the finding as the comment, on the reader's way to GitHub
// (Comment, or Review). Only the box sends.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { findingCommentText } from "../../comments/plan-comment.ts";
import { pickForNextBox } from "../comments/send-as.tsx";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import type { OpenBox } from "../diff/pr-diff.tsx";
import { Button } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";
import { Priority } from "./priority.tsx";

type FindingBlockProps = { shown: VisibleFinding; openBox: OpenBox };

// The surface is recessed, with no border or bar: the priority word is its only colour.
export function FindingBlock({ shown: { finding, index }, openBox }: FindingBlockProps) {
  return (
    <section aria-label={`Finding: ${finding.title}`} className="grid gap-1 rounded-[10px] bg-[color-mix(in_oklab,var(--foreground)_5%,var(--background))] px-3.5 py-3 text-[13px] leading-5">
      <div className="flex items-baseline gap-2">
        <Priority priority={finding.priority} />
        <Prose text={finding.title} className="min-w-0 font-semibold" />
      </div>
      <Prose text={finding.body} className="max-w-[72ch] text-muted-foreground" />
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          variant="outline"
          size="small"
          onClick={(event) => {
            pickForNextBox("ask");
            openBox({ finding: index, prefill: "", from: event.currentTarget });
          }}
        >
          <Icon name="SideChat" className="size-3.5" aria-hidden />
          Ask about this
        </Button>
        <Button
          variant="outline"
          size="small"
          onClick={(event) => {
            pickForNextBox("github");
            openBox({ finding: index, prefill: findingCommentText(finding), from: event.currentTarget });
          }}
        >
          <Icon name="GithubLogo" className="size-3.5" aria-hidden />
          Comment
        </Button>
      </div>
    </section>
  );
}
