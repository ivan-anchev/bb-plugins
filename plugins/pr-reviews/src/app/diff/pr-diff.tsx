// Every diff the plugin draws: one PR file, or one hunk of it, at the commit the page shows, in
// bb's host-shared Pierre diff with bb's theme. Things drawn under a line, such as a guide's
// findings, come in as notes. GitHub's review threads come placed: under their last line, or
// above the diff at their file. A file with no text hunks (binary, a rename, an empty or mode-only
// change) draws only its threads at its file. The lines the reader selects, from the gutter or a finding's
// buttons, get the diff's one comment box under their last line; a thread's Reply gets it in the
// thread.
import { useMemo, useRef, type ReactNode } from "react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { LineRef } from "../../comments/comment-schema.ts";
import { refOf, spanBetween, type LineSpan } from "../../comments/line-span.ts";
import type { FileThread, LineThread, PlacedThreads } from "../../comments/place-threads.ts";
import type { ReviewThread } from "../../comments/thread-schema.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { CommentBox, type BoxSubject } from "../comments/comment-box.tsx";
import { ReviewThreadCard } from "../comments/review-thread.tsx";
import { usePullRequest, type PrHeadTarget } from "../queries.ts";
import { DiffErrorBoundary } from "./diff-error-boundary.tsx";
import { DIFF_TEXT_CLASS, fileDiffOf, useDiffOptions, type DiffSettings } from "./diff-options.ts";
import { highlightOf, type LineBox } from "./line-selection.ts";
import { pierreSideOf, useLineSelection, type FindingBoxRequest } from "./use-line-selection.ts";

/** Opens the diff's comment box under a note's line, for one of a finding's buttons. */
export type OpenBox = (request: Omit<FindingBoxRequest, "at">) => void;

/** Something drawn under a line, such as a finding card, given what opens the box under it. */
export type LineNote = { at: LineRef; render(openBox: OpenBox): ReactNode };

type PrDiffProps = {
  /** The file with the hunks to draw: all of them on the Changes tab, one in a guide step, none for a file with no text hunks. */
  file: DiffFile;
  /** The PR and the commit this diff is at: the commit a comment or a question about its lines names. */
  head: PrHeadTarget;
  /** The file's text at `head.headSha` once read, or null: with it the unchanged lines expand. */
  newContent: string | null;
  settings: DiffSettings;
  /** Several notes on one line draw in their order. */
  notes: readonly LineNote[];
  /** This file's review threads in this diff (place-threads.ts); under a line, above its notes. */
  threads: PlacedThreads;
};

type LinesBox = Extract<LineBox, { kind: "lines" }>;

// The box's annotation carries its lines as rows, so the box never draws without them.
type Annotation = { kind: "note"; note: LineNote } | { kind: "thread"; placed: LineThread } | { kind: "box"; span: LineSpan; box: LinesBox };

export function PrDiff(props: PrDiffProps) {
  // Keyed by the file at its commit: another file, or a new head whose lines may be gone, starts
  // with nothing selected, no draft and a clean boundary.
  return (
    <DiffErrorBoundary key={`${props.head.headSha}:${props.file.path}`}>
      <SelectableDiff {...props} />
    </DiffErrorBoundary>
  );
}

function SelectableDiff({ file, head, newContent, settings, notes, threads }: PrDiffProps) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useLineSelection(root);
  const { lines } = selection;
  const options = useDiffOptions<Annotation>(settings, selection.gestures);
  const fileDiff = useMemo(() => fileDiffOf(file, newContent), [file, newContent]);
  const rows = useMemo(() => diffRowsOf(file, newContent), [file, newContent]);
  const { box } = lines;
  // The page draws only once the PR is read; this is the same cache entry.
  const prAuthor = usePullRequest(head.projectId, head.number).data?.pr.author ?? null;
  const span = useMemo(() => (box?.kind !== "lines" ? null : spanBetween(file.path, head.headSha, rows, ...refsOf(box.at))), [file.path, head.headSha, rows, box]);
  const annotations = useMemo(
    () => annotationsOf(notes, threads.lines, box?.kind !== "lines" || span === null ? null : { kind: "box", span, box }),
    [notes, threads.lines, span, box],
  );

  // Keyed by each opening: the box is drawn afresh, on its Write tab, and takes focus.
  const commentBox = (opened: LineBox, subject: BoxSubject) => (
    <CommentBox
      key={opened.opened}
      subject={subject}
      head={head}
      box={opened}
      draft={lines.draft}
      onDraft={selection.setDraft}
      onSettled={selection.settle}
      onClose={selection.close}
    />
  );
  const threadCard = (thread: ReviewThread, atFile: FileThread | null) => (
    <ReviewThreadCard
      thread={thread}
      atFile={atFile}
      prAuthor={prAuthor}
      box={box?.kind === "reply" && box.threadId === thread.id ? commentBox(box, { kind: "reply", thread }) : null}
      onReply={({ quote, from }) => selection.openForReply({ threadId: thread.id, quote, from })}
    />
  );

  return (
    // why a focus target: when the box unmounts with focus inside it, focus lands here rather
    // than on the page body (REVIEW.md).
    <div ref={root} tabIndex={-1} className={`outline-none ${THREAD_EDGE}`}>
      {/* why `minmax(0,1fr)`: an implicit `auto` track grows to an outdated thread's widest code line,
          so the excerpt would widen the thread, not scroll in it. */}
      {threads.file.length > 0 && (
        <div className={`grid grid-cols-[minmax(0,1fr)] gap-2 pl-(--pr-reviews-thread-edge) ${THREAD_GAP}`}>
          {threads.file.map((placed) => (
            <div key={placed.thread.id}>{threadCard(placed.thread, placed)}</div>
          ))}
        </div>
      )}
      {file.hunks.length > 0 && (
        <FileDiff<Annotation>
          className={DIFF_TEXT_CLASS}
          fileDiff={fileDiff}
          options={options}
          // why always passed, null included: it makes the selection controlled, so the highlight is
          // always this state.
          selectedLines={highlightOf(lines)}
          lineAnnotations={annotations}
          renderAnnotation={({ metadata }) => (
            <div className={metadata.kind === "thread" ? THREAD_NOTE_CLASS : NOTE_CLASS}>
              {metadata.kind === "note" && metadata.note.render((request) => selection.openFromFinding({ ...request, at: metadata.note.at }))}
              {metadata.kind === "thread" && threadCard(metadata.placed.thread, null)}
              {metadata.kind === "box" && commentBox(metadata.box, { kind: "lines", span: metadata.span, finding: metadata.box.finding })}
            </div>
          )}
        />
      )}
    </div>
  );
}

// why: a note is slotted into the diff's rows and would inherit their code font, `white-space:
// pre` and the code theme's colour; it reads as the page's text.
const NOTE_BASE = "grid gap-3 font-sans whitespace-normal text-foreground";
// Its padding lines it up with the code's text.
const NOTE_CLASS = `${NOTE_BASE} pt-3 pr-2.5 pb-3.5 pl-2.5`;

// A review thread sits in the band on the page's background with an even 8px around it: from the
// rows above and below, and the diff's right edge, under a line and at the file alike. Its left
// edge is THREAD_EDGE.
const THREAD_GAP = "py-2 pr-2";

// A review thread's avatars line up with the line numbers, on a line and at the file alike. Pierre
// insets its numbers 2ch from the diff's left edge, 14.4px at DIFF_TEXT_CLASS's 12px, and a thread
// card's avatars sit 6px inside it (review-thread.tsx): the card starts 8.4px in, the band's 8px.
const THREAD_EDGE = "[--pr-reviews-thread-edge:8.4px]";

// Under a line the card reaches back across the gutter, which the diff's options raise it over.
const THREAD_NOTE_CLASS = `${NOTE_BASE} ${THREAD_GAP} ml-[calc(var(--pr-reviews-thread-edge)-var(--diffs-column-number-width))]`;

// Pierre's sides are the diff's columns: deletions is the old side, additions the new.
const sideOfPierre = (side: SelectedLineRange["side"]): LineRef["side"] => (side === "deletions" ? "old" : "new");

const refsOf = ({ start, side, end, endSide = side }: SelectedLineRange): [LineRef, LineRef] => [
  { side: sideOfPierre(side), line: start },
  { side: sideOfPierre(endSide), line: end },
];

// Threads first, then notes, the box last: annotations on one line share one slot in order, so
// GitHub's threads sit above a guide's findings, and the box under both on its last line.
function annotationsOf(notes: readonly LineNote[], threads: readonly LineThread[], drawn: Extract<Annotation, { kind: "box" }> | null): DiffLineAnnotation<Annotation>[] {
  const noted = [
    ...threads.map((placed): DiffLineAnnotation<Annotation> => ({ side: pierreSideOf(placed.at), lineNumber: placed.at.line, metadata: { kind: "thread", placed } })),
    ...notes.map((note): DiffLineAnnotation<Annotation> => ({ side: pierreSideOf(note.at), lineNumber: note.at.line, metadata: { kind: "note", note } })),
  ];
  if (drawn === null) return noted;
  const last = refOf(drawn.span.rows[drawn.span.rows.length - 1]);
  return [...noted, { side: pierreSideOf(last), lineNumber: last.line, metadata: drawn }];
}
