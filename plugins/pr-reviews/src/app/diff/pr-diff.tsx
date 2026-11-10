// Every diff the plugin draws: one PR file, or one hunk of it, at the commit the page shows, in
// bb's host-shared Pierre diff with bb's theme. Things drawn under a line, such as a guide's
// findings, come in as notes; the lines the reader selects, from the gutter or a finding's
// buttons, get the diff's one comment box under their last line.
import { useMemo, useRef, type ReactNode } from "react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { LineRef } from "../../comments/comment-schema.ts";
import { refOf, spanBetween, type LineSpan } from "../../comments/line-span.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { CommentBox } from "../comments/comment-box.tsx";
import type { PrHeadTarget } from "../queries.ts";
import { DiffErrorBoundary } from "./diff-error-boundary.tsx";
import { DIFF_TEXT_CLASS, fileDiffOf, useDiffOptions, type DiffSettings } from "./diff-options.ts";
import { highlightOf, type LineBox } from "./line-selection.ts";
import { pierreSideOf, useLineSelection, type FindingBoxRequest } from "./use-line-selection.ts";

/** Opens the diff's comment box under a note's line, for one of a finding's buttons. */
export type OpenBox = (request: Omit<FindingBoxRequest, "at">) => void;

/** Something drawn under a line, such as a finding card, given what opens the box under it. */
export type LineNote = { at: LineRef; render(openBox: OpenBox): ReactNode };

type PrDiffProps = {
  /** The file with the hunks to draw: all of them on the Changes tab, one in a guide step. */
  file: DiffFile;
  /** The PR and the commit this diff is at: the commit a comment or a question about its lines names. */
  head: PrHeadTarget;
  /** The file's text at `head.headSha` once read, or null: with it the unchanged lines expand. */
  newContent: string | null;
  settings: DiffSettings;
  /** Several notes on one line draw in their order. */
  notes: readonly LineNote[];
};

// The box's annotation carries its lines as rows, so the box never draws without them.
type Annotation = { kind: "note"; note: LineNote } | { kind: "box"; span: LineSpan; box: LineBox };

export function PrDiff(props: PrDiffProps) {
  // Keyed by the file at its commit: another file, or a new head whose lines may be gone, starts
  // with nothing selected, no draft and a clean boundary.
  return (
    <DiffErrorBoundary key={`${props.head.headSha}:${props.file.path}`}>
      <SelectableDiff {...props} />
    </DiffErrorBoundary>
  );
}

function SelectableDiff({ file, head, newContent, settings, notes }: PrDiffProps) {
  const root = useRef<HTMLDivElement>(null);
  const selection = useLineSelection(root);
  const { lines } = selection;
  const options = useDiffOptions<Annotation>(settings, selection.gestures);
  const fileDiff = useMemo(() => fileDiffOf(file, newContent), [file, newContent]);
  const rows = useMemo(() => diffRowsOf(file, newContent), [file, newContent]);
  const { box } = lines;
  const span = useMemo(() => (box === null ? null : spanBetween(file.path, head.headSha, rows, ...refsOf(box.at))), [file.path, head.headSha, rows, box]);
  const annotations = useMemo(() => annotationsOf(notes, box === null || span === null ? null : { kind: "box", span, box }), [notes, span, box]);

  return (
    // why a focus target: when the box unmounts with focus inside it, focus lands here rather
    // than on the page body (REVIEW.md).
    <div ref={root} tabIndex={-1} className="outline-none">
      <FileDiff<Annotation>
        className={DIFF_TEXT_CLASS}
        fileDiff={fileDiff}
        options={options}
        // why always passed, null included: it makes the selection controlled, so the highlight is
        // always this state.
        selectedLines={highlightOf(lines)}
        lineAnnotations={annotations}
        renderAnnotation={({ metadata }) => (
          <div className={NOTE_CLASS}>
            {metadata.kind === "note" ? (
              metadata.note.render((request) => selection.openFromFinding({ ...request, at: metadata.note.at }))
            ) : (
              // Keyed by each opening: the box is drawn afresh, on its Write tab, and takes focus.
              <CommentBox
                key={metadata.box.opened}
                span={metadata.span}
                head={head}
                box={metadata.box}
                draft={lines.draft}
                onDraft={selection.setDraft}
                onSettled={selection.settle}
                onClose={selection.close}
              />
            )}
          </div>
        )}
      />
    </div>
  );
}

// why: a note is slotted into the diff's rows and would inherit their code font, `white-space:
// pre` and the code theme's colour; it reads as the page's text.
// Its padding lines it up with the code's text.
const NOTE_CLASS = "pt-2 pr-3 pb-3 pl-2 font-sans whitespace-normal text-foreground";

// Pierre's sides are the diff's columns: deletions is the old side, additions the new.
const sideOfPierre = (side: SelectedLineRange["side"]): LineRef["side"] => (side === "deletions" ? "old" : "new");

const refsOf = ({ start, side, end, endSide = side }: SelectedLineRange): [LineRef, LineRef] => [
  { side: sideOfPierre(side), line: start },
  { side: sideOfPierre(endSide), line: end },
];

// Notes first, the box last: annotations on one line share one slot in order, so the box sits
// under any finding on its last line.
function annotationsOf(notes: readonly LineNote[], drawn: Extract<Annotation, { kind: "box" }> | null): DiffLineAnnotation<Annotation>[] {
  const noted = notes.map((note): DiffLineAnnotation<Annotation> => ({ side: pierreSideOf(note.at), lineNumber: note.at.line, metadata: { kind: "note", note } }));
  if (drawn === null) return noted;
  const last = refOf(drawn.span.rows[drawn.span.rows.length - 1]);
  return [...noted, { side: pierreSideOf(last), lineNumber: last.line, metadata: drawn }];
}
