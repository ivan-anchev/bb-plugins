// A finding under its line in a step's diff, drawn like the diff's "N unmodified lines" separator:
// the priority word, the title and the body, then its actions. "Ask about this" opens a question to
// the review thread, which answers in the thread; "Comment as is" and "Edit and comment" open a
// GitHub comment on the finding's line. One box is open at a time.
import { useId, useMemo, useRef, useState } from "react";
import { spanAt } from "../../comments/line-span.ts";
import { findingCommentText } from "../../comments/plan-comment.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import { CommentComposer } from "../comments/comment-composer.tsx";
import { useAskAboutFinding, type PrHeadTarget } from "../queries.ts";
import { DraftBox } from "../ui/draft-box.tsx";
import { Prose } from "../ui/prose.tsx";
import { Priority } from "./priority.tsx";

/** `file`: the finding's file as drawn around it, narrowed to its one hunk. */
type FindingBlockProps = { shown: VisibleFinding; file: DiffFile; head: PrHeadTarget };

type FindingAction = "ask" | "comment-as-is" | "edit-and-comment";

const ACTIONS: readonly { action: FindingAction; label: string }[] = [
  { action: "ask", label: "Ask about this" },
  { action: "comment-as-is", label: "Comment as is" },
  { action: "edit-and-comment", label: "Edit and comment" },
];

// The buttons stay put while a box is open, so focus can always come back to the one that opened it.
export function FindingBlock({ shown, file, head }: FindingBlockProps) {
  const { finding } = shown;
  const [open, setOpen] = useState<FindingAction | null>(null);
  const toggles = { ask: useRef<HTMLButtonElement>(null), "comment-as-is": useRef<HTMLButtonElement>(null), "edit-and-comment": useRef<HTMLButtonElement>(null) };
  const box = useRef<HTMLDivElement>(null);
  const boxId = useId();
  // The finding's one row at the guide's head: a comment on it anchors to its line and side.
  const span = useMemo(() => spanAt(finding.file, head.headSha, diffRowsOf(file, null), { side: finding.side, line: finding.line }), [file, finding, head.headSha]);

  // Focus comes back to the box's button only from inside the closing box, never from elsewhere on the page.
  const close = () => {
    if (open !== null && box.current?.contains(document.activeElement)) toggles[open].current?.focus();
    setOpen(null);
  };
  const question = useQuestion(shown, head, close);
  const toggle = (action: FindingAction) => {
    question.clearSent();
    if (open === action) close();
    else setOpen(action);
  };

  return (
    <div className="px-2 pt-1 pb-1.5">
      <section className="grid gap-1 rounded-md bg-muted px-2.5 pt-2 pb-[9px] text-[13px] leading-[19px]">
        <div className="flex items-baseline gap-2">
          <Priority priority={finding.priority} />
          <Prose text={finding.title} className="min-w-0 font-semibold" />
        </div>
        <Prose text={finding.body} className="max-w-[78ch] text-muted-foreground" />
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
          {ACTIONS.map(({ action, label }) => (
            <button
              key={action}
              ref={toggles[action]}
              type="button"
              aria-expanded={open === action}
              aria-controls={open === action ? boxId : undefined}
              onClick={() => toggle(action)}
              className="-mx-1 min-h-6 cursor-pointer touch-manipulation rounded-sm px-1 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
            >
              {label}
            </button>
          ))}
          <span aria-live="polite" className="text-xs text-subtle-foreground">
            {question.sent && "Sent to the review thread. Its answer is in Review chat."}
          </span>
        </div>
        {open === "ask" && (
          <DraftBox
            id={boxId}
            ref={box}
            textareaRef={question.textarea}
            label="Question for the review thread"
            placeholder="Ask the review thread about this…"
            value={question.draft}
            onChange={question.setDraft}
            onEscapeEmpty={close}
            onCancel={close}
            error={question.error}
            action={{ label: "Send", pending: question.pending, run: question.send }}
          />
        )}
        {(open === "comment-as-is" || open === "edit-and-comment") && (
          <div id={boxId} ref={box}>
            {/* Keyed: switching between the two starts the box over at its own step. */}
            <CommentComposer
              key={open}
              span={span}
              head={head}
              initialText={findingCommentText(finding)}
              startAt={open === "comment-as-is" ? "review" : "write"}
              onCancel={close}
              onDone={close}
            />
          </div>
        )}
      </section>
    </div>
  );
}

// The question about this finding. The draft and an error stay until a send succeeds; closing
// the box only folds the question away. The reader can keep writing, or move to another box,
// while a send is in flight: only the text that was sent is done with. A draft changed since then
// stays, unsent, and an open box closes only while it still holds the sent text.
function useQuestion(shown: VisibleFinding, head: PrHeadTarget, close: () => void) {
  const ask = useAskAboutFinding();
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const question = draft;
    return ask
      .mutate({ ...head, findingIndex: shown.index, question })
      .then(() => {
        setSent(true);
        setDraft((current) => (current === question ? "" : current));
        if (textarea.current?.value === question) close();
      })
      .catch(() => undefined);
  };
  return { draft, setDraft, sent, clearSent: () => setSent(false), textarea, send, pending: ask.isPending, error: ask.error?.message ?? null };
}
