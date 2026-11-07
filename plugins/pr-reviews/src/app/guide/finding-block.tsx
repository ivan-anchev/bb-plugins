// A finding under its line in a step's diff, drawn like the diff's "N unmodified lines" separator:
// the priority word, the title and the body, and "Ask about this", which opens a question to the
// review thread. The thread answers in the thread; this page stays as it is.
import { useId, useRef, useState } from "react";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import { useAskAboutFinding, type GuideTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { Prose } from "../ui/prose.tsx";
import { Priority } from "./priority.tsx";

type FindingBlockProps = { shown: VisibleFinding; target: GuideTarget };

export function FindingBlock({ shown, target }: FindingBlockProps) {
  const { finding } = shown;
  return (
    <div className="px-2 pt-1 pb-1.5">
      <section className="grid gap-1 rounded-md bg-muted px-2.5 pt-2 pb-[9px] text-[13px] leading-[19px]">
        <div className="flex items-baseline gap-2">
          <Priority priority={finding.priority} />
          <Prose text={finding.title} className="min-w-0 font-semibold" />
        </div>
        <Prose text={finding.body} className="max-w-[78ch] text-muted-foreground" />
        <AskAboutThis shown={shown} target={target} />
      </section>
    </div>
  );
}

// "Ask about this" stays put while the question is open, so focus can always come back to it.
// The draft and an error stay until a send succeeds; Cancel only folds the question away.
function AskAboutThis({ shown, target }: FindingBlockProps) {
  const ask = useAskAboutFinding();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const questionId = useId();

  // Focus comes back to "Ask about this" only from inside the closing question, never from elsewhere on the page.
  const close = () => {
    if (editor.current?.contains(document.activeElement)) toggle.current?.focus();
    setOpen(false);
  };
  // The reader can keep writing, or move to another question, while a send is in flight. Only the
  // text that was sent is done with: a draft changed since then stays, unsent, and an open editor
  // closes only while it still holds the sent text.
  const send = () => {
    const question = draft;
    void ask
      .mutate({ ...target, findingIndex: shown.index, question })
      .then(() => {
        setSent(true);
        setDraft((current) => (current === question ? "" : current));
        if (textarea.current?.value === question) close();
      })
      .catch(() => undefined);
  };

  return (
    <>
      <div className="mt-0.5 flex items-baseline gap-3">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls={open ? questionId : undefined}
          onClick={() => {
            setSent(false);
            if (open) close();
            else setOpen(true);
          }}
          className="-mx-1 min-h-6 cursor-pointer touch-manipulation rounded-sm px-1 text-[12.5px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        >
          Ask about this
        </button>
        <span aria-live="polite" className="text-xs text-subtle-foreground">
          {sent && "Sent to the review thread. Its answer is in Open thread."}
        </span>
      </div>
      {open && (
        <div ref={editor} id={questionId} className="mt-1 grid gap-1.5">
          <label htmlFor={`${questionId}-text`} className="sr-only">
            Question for the review thread
          </label>
          <textarea
            ref={textarea}
            id={`${questionId}-text`}
            autoFocus
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask the review thread about this…"
            className="min-h-[52px] w-full resize-y rounded-md bg-background px-2.5 py-2 text-[13px] leading-[19px] text-foreground outline-none placeholder:text-subtle-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex items-center justify-end gap-1.5">
            {ask.error !== null && (
              <p role="alert" className="mr-auto text-xs text-destructive">
                {ask.error.message}
              </p>
            )}
            <Button variant="ghost" size="small" onClick={close}>
              Cancel
            </Button>
            {/* why aria-disabled while sending: a disabled button drops the focus a click on it gave,
                and the question gives focus back only from inside itself. */}
            <Button variant="primary" size="small" onClick={ask.isPending ? undefined : send} aria-disabled={ask.isPending} disabled={draft.trim() === ""}>
              Send
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
