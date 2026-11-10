// A GitHub review comment on some lines, from writing it to its link: write, then a preview of
// exactly what will be posted and where, then Post on an explicit click. The draft stays through
// every failure. Used under selected lines and on a finding.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { experimental_PluginRpcCallError as RpcCallError, UrlLink } from "@get-bb/plugin-sdk/app";
import { commitsSince, shortSha, type PrDetail, type PrState } from "../../contract.ts";
import { GITHUB_BODY_LIMIT, githubSideOf, type CommentRequest } from "../../comments/comment-schema.ts";
import { linesLabel, quoteOf, type LineSpan } from "../../comments/line-span.ts";
import { planComment, type CommentPlan } from "../../comments/plan-comment.ts";
import type { Repo } from "../../github/repo.ts";
import { useLifetime } from "../lifetime.ts";
import { usePostComment, usePullRequest, type PrHeadTarget } from "../queries.ts";
import { Button } from "../ui/button.tsx";
import { DESTRUCTIVE_TEXT_ON_MUTED } from "../ui/destructive-text-on-muted.ts";
import { DraftBox } from "../ui/draft-box.tsx";
import { useHoldEscape } from "../ui/hold-escape.ts";

type CommentComposerProps = {
  /** The lines the comment is on, at the commit the reader views. */
  span: LineSpan;
  head: PrHeadTarget;
  initialText: string;
  /** "review" opens straight at the preview: a finding's "Comment as is". */
  startAt: "write" | "review";
  /** Close the box without posting. */
  onCancel(): void;
  /** Done, after the comment was posted. */
  onDone(): void;
};

// The page draws only once the PR is read, and this is the same cache entry, so it is there.
export function CommentComposer(props: CommentComposerProps) {
  const pull = usePullRequest(props.head.projectId, props.head.number);
  return pull.data === undefined ? null : <Composer {...props} read={pull.data} />;
}

/** The PR as the page last read it. */
type PrRead = { repo: Repo; pr: PrDetail };

/** Where a planned comment goes, as it was when the reader asked for the preview. */
type Destination = { repo: Repo; number: number; state: PrState };

// why the plan and its destination live in the state: they are made when Preview is clicked and
// never in render, so a refresh of the PR can't change the request under the Post click.
type Step =
  | { step: "editing"; text: string }
  | { step: "blocked"; text: string; reason: string }
  | { step: "preview"; text: string; plan: CommentPlan; to: Destination }
  | { step: "posting"; text: string; plan: CommentPlan; to: Destination }
  | { step: "failed"; text: string; plan: CommentPlan; to: Destination; message: string }
  | { step: "posted"; url: string };

function Composer({ span, head, initialText, startAt, onCancel, onDone, read }: CommentComposerProps & { read: PrRead }) {
  const post = usePostComment();
  const life = useLifetime();
  useHoldEscape();
  const [state, setState] = useState<Step>(() => (startAt === "review" ? previewOf(span, read, initialText) : { step: "editing", text: initialText }));
  // why a latch beside the "posting" step: the step arrives with the next render, so a quick
  // second click would post twice.
  const posting = useRef(false);

  const send = (current: Extract<Step, { step: "preview" | "failed" }>) => {
    if (posting.current) return;
    posting.current = true;
    const { text, plan, to } = current;
    setState({ step: "posting", text, plan, to });
    void post
      .mutate({ projectId: head.projectId, number: head.number, request: plan.request })
      .then(
        life.bind(({ url }: { url: string }) => setState({ step: "posted", url })),
        life.bind((error: unknown) => setState({ step: "failed", text, plan, to, message: RpcCallError.from(error).message })),
      )
      .finally(() => (posting.current = false));
  };

  function renderStep() {
    switch (state.step) {
      case "editing":
        return <WriteStep text={state.text} onChange={(text) => setState({ step: "editing", text })} onCancel={onCancel} onPreview={() => setState(previewOf(span, read, state.text))} />;
      case "blocked":
        return <Blocked reason={state.reason} onBack={() => setState({ step: "editing", text: state.text })} />;
      case "preview":
      case "posting":
      case "failed": {
        const current = state;
        return (
          <Preview
            span={span}
            plan={current.plan}
            to={current.to}
            posting={current.step === "posting"}
            error={current.step === "failed" ? current.message : null}
            onBack={() => setState({ step: "editing", text: current.text })}
            onPost={current.step === "posting" ? null : () => send(current)}
          />
        );
      }
      case "posted":
        return <Posted url={state.url} onDone={onDone} />;
      default:
        return state satisfies never;
    }
  }

  return (
    // why every Esc in the box stops here as well as at the hold: Done takes the hold with it
    // before the event gets that far, and bb's own Esc would leave the page.
    <div onKeyDown={(event: KeyboardEvent) => escapeIn(event, state.step === "posted" ? onDone : null)}>{renderStep()}</div>
  );
}

// A comment is planned only on a commit still in the PR (planComment says why).
function previewOf(span: LineSpan, { repo, pr }: PrRead, text: string): Step {
  const planned = planComment(span, commitsSince(pr, span.commit) !== null, text);
  if ("blocked" in planned) return { step: "blocked", text, reason: planned.blocked };
  return { step: "preview", text, plan: planned, to: { repo, number: pr.number, state: pr.state } };
}

function escapeIn(event: KeyboardEvent, close: (() => void) | null) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  close?.();
}

function WriteStep({ text, onChange, onCancel, onPreview }: { text: string; onChange(text: string): void; onCancel(): void; onPreview(): void }) {
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  return (
    <DraftBox
      id={id}
      textareaRef={textarea}
      label="Comment for GitHub"
      placeholder="Write a comment for GitHub…"
      value={text}
      onChange={onChange}
      onEscapeEmpty={onCancel}
      onCancel={onCancel}
      error={null}
      action={{ label: "Preview", pending: false, run: async () => onPreview() }}
    />
  );
}

// Takes focus when it replaces the write step, whose focused button it unmounted.
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current!.focus(), []);
  return ref;
}

function Blocked({ reason, onBack }: { reason: string; onBack(): void }) {
  const back = useFocusOnMount<HTMLButtonElement>();
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <p role="alert" className={`mr-auto text-xs ${DESTRUCTIVE_TEXT_ON_MUTED}`}>
        {reason}
      </p>
      <Button ref={back} variant="ghost" size="small" onClick={onBack}>
        Back to edit
      </Button>
    </div>
  );
}

type PreviewProps = {
  span: LineSpan;
  plan: CommentPlan;
  to: Destination;
  posting: boolean;
  error: string | null;
  onBack(): void;
  /** Null while the comment is posting. */
  onPost: (() => void) | null;
};

// What and where, from the request itself: the PR, the kind, the file, the lines, the side, the
// commit, why it fell back, and the body exactly as it will be posted (raw text, not rendered).
function Preview({ span, plan, to, posting, error, onBack, onPost }: PreviewProps) {
  const { request, why } = plan;
  const region = useFocusOnMount<HTMLElement>();
  const { start, end } = quoteOf(span);
  const tooLong = request.body.length > GITHUB_BODY_LIMIT;
  const post = tooLong ? null : onPost;
  return (
    // why a focus target: Preview, which had focus, went with the write step (REVIEW.md).
    <section ref={region} tabIndex={-1} aria-label="Comment preview" className="mt-1 grid gap-1.5 outline-none">
      <p className="text-[13px] font-semibold">
        Post to {to.repo}#{to.number}
        {stateNoteOf(to.state)} as {request.kind === "line" ? "a line comment" : "a file comment"}
      </p>
      <p className="font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground">
        {[span.path, linesLabel(start, end), ...sidesOf(request), `commit ${shortSha(request.commit)}`].join(" · ")}
      </p>
      {why !== null && <p className="text-xs text-muted-foreground">{why}</p>}
      {/* why its own tab stop: a long body scrolls here, and the keys scroll only what has focus. */}
      <pre
        role="region"
        aria-label="Comment body"
        tabIndex={0}
        className="max-h-64 overflow-auto rounded-md bg-background px-2.5 py-2 font-mono text-xs whitespace-pre-wrap break-words text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {request.body}
      </pre>
      {tooLong && (
        <p role="alert" className={`text-xs ${DESTRUCTIVE_TEXT_ON_MUTED}`}>
          This comment is {request.body.length.toLocaleString("en")} characters, and GitHub takes at most {GITHUB_BODY_LIMIT.toLocaleString("en")}. Go back to shorten it, or select fewer lines.
        </p>
      )}
      <div className="flex items-center justify-end gap-1.5">
        {error !== null && (
          <p role="alert" className={`mr-auto text-xs ${DESTRUCTIVE_TEXT_ON_MUTED}`}>
            {error}
          </p>
        )}
        <Button variant="ghost" size="small" onClick={posting ? undefined : onBack} aria-disabled={posting}>
          Back to edit
        </Button>
        {/* why aria-disabled, not disabled: a disabled button drops the focus its click gave. */}
        <Button variant="primary" size="small" onClick={post ?? undefined} aria-disabled={post === null}>
          {posting ? "Posting…" : "Post to GitHub"}
        </Button>
      </div>
    </section>
  );
}

const stateNoteOf = (state: PrState) => (state === "CLOSED" || state === "MERGED" ? ` (${state.toLowerCase()})` : "");

// One side, or "LEFT to RIGHT" for a range across them; a file comment has none.
function sidesOf(request: CommentRequest): string[] {
  if (request.kind === "file") return [];
  const end = githubSideOf(request.end.side);
  return [request.start === null || request.start.side === request.end.side ? end : `${githubSideOf(request.start.side)} to ${end}`];
}

// The comment's own page; Done folds the box away. No Post button remains, so it can't post twice.
function Posted({ url, onDone }: { url: string; onDone(): void }) {
  const done = useFocusOnMount<HTMLButtonElement>();
  return (
    <div className="mt-1 flex items-center gap-3">
      <p role="status" className="mr-auto text-[13px]">
        Posted.{" "}
        <UrlLink href={url} className="rounded-sm font-medium text-foreground underline decoration-foreground/35 underline-offset-[3px] hover:decoration-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none">
          View on GitHub ↗
        </UrlLink>
      </p>
      <Button ref={done} variant="ghost" size="small" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
