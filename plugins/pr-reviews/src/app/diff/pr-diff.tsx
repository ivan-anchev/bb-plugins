// Every diff the plugin draws: one PR file, or one hunk of it, at the commit the page shows, in
// bb's host-shared Pierre diff with bb's theme. Things drawn under a line, such as a guide's
// findings, come in as notes; the lines the reader selects from the gutter numbers get the
// selection panel under their last line.
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { LineRef } from "../../comments/comment-schema.ts";
import { refOf, spanBetween, type LineSpan } from "../../comments/line-span.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { PrHeadTarget } from "../queries.ts";
import { DiffErrorBoundary } from "./diff-error-boundary.tsx";
import { DIFF_TEXT_CLASS, fileDiffOf, useDiffOptions, type DiffSettings } from "./diff-options.ts";
import type { LinePanel } from "./line-selection.ts";
import { SelectionPanel } from "./selection-panel.tsx";
import { useLineSelection } from "./use-line-selection.ts";

/** Something drawn under a line, such as a finding card. */
export type LineNote = { at: LineRef; node: ReactNode };

type PrDiffProps = {
  /** The file with the hunks to draw: all of them on the Changes tab, one in a guide step. */
  file: DiffFile;
  /** The PR and the commit this diff is at: the commit a question about its lines names. */
  head: PrHeadTarget;
  /** The file's text at `head.headSha` once read, or null: with it the unchanged lines expand. */
  newContent: string | null;
  settings: DiffSettings;
  /** Several notes on one line draw in their order. */
  notes: readonly LineNote[];
};

// The selection's annotation carries its span and panel, so the panel never draws without them.
type Annotation = { kind: "note"; node: ReactNode } | { kind: "selection"; span: LineSpan; panel: LinePanel };

export function PrDiff(props: PrDiffProps) {
  // Keyed by the file at its commit: another file, or a new head whose lines may be gone, starts
  // with nothing selected and a clean boundary.
  return (
    <DiffErrorBoundary key={`${props.head.headSha}:${props.file.path}`}>
      <SelectableDiff {...props} />
    </DiffErrorBoundary>
  );
}

function SelectableDiff({ file, head, newContent, settings, notes }: PrDiffProps) {
  const root = useRef<HTMLDivElement>(null);
  const lines = useLineSelection(root);
  const [sent, setSent] = useState(false);
  const options = useDiffOptions<Annotation>(settings, lines.gestures);
  const fileDiff = useMemo(() => fileDiffOf(file, newContent), [file, newContent]);
  const rows = useMemo(() => diffRowsOf(file, newContent), [file, newContent]);
  const { selection } = lines;
  // Nothing is drawn under lines still being picked: the annotations, and so Pierre's rows, stay
  // as they are through a drag.
  const panel = selection?.panel ?? null;
  const range = selection !== null && selection.panel !== null ? selection.range : null;
  const span = useMemo(() => (range === null ? null : spanBetween(file.path, head.headSha, rows, ...refsOf(range))), [file.path, head.headSha, rows, range]);
  const annotations = useMemo(() => annotationsOf(notes, span === null || panel === null ? null : { kind: "selection", span, panel }), [notes, span, panel]);
  const onSent = () => {
    lines.clear();
    setSent(true);
  };

  return (
    // why a focus target: when the selection panel unmounts with focus inside it, focus lands
    // here rather than on the page body (REVIEW.md).
    <div ref={root} tabIndex={-1} className="outline-none">
      <FileDiff<Annotation>
        className={DIFF_TEXT_CLASS}
        fileDiff={fileDiff}
        options={options}
        // why always passed, null included: it makes the selection controlled, so the highlight is
        // always this state, and an open box keeps its lines.
        selectedLines={selection?.range ?? null}
        lineAnnotations={annotations}
        renderAnnotation={({ metadata }) => (
          <div className={NOTE_TEXT}>
            {metadata.kind === "note" ? (
              metadata.node
            ) : (
              <SelectionPanel span={metadata.span} head={head} panel={metadata.panel} onAsk={lines.openAsk} onCloseBox={lines.closeBox} onDone={onSent} />
            )}
          </div>
        )}
      />
      {/* The panel is gone once the question is sent; this says where it went. */}
      <p role="status" className="sr-only">
        {sent && selection === null ? "Sent to the review thread. Its answer is in Review chat." : ""}
      </p>
    </div>
  );
}

// why: a note is slotted into the diff's rows and would inherit their code font, `white-space:
// pre` and the code theme's colour; it reads as the page's text.
const NOTE_TEXT = "font-sans whitespace-normal text-foreground";

// Pierre's sides are the diff's columns: deletions is the old side, additions the new.
const sideOfPierre = (side: SelectedLineRange["side"]): LineRef["side"] => (side === "deletions" ? "old" : "new");
const pierreSideOf = (ref: LineRef) => (ref.side === "old" ? "deletions" : "additions");

const refsOf = ({ start, side, end, endSide = side }: SelectedLineRange): [LineRef, LineRef] => [
  { side: sideOfPierre(side), line: start },
  { side: sideOfPierre(endSide), line: end },
];

// Notes first, the selection last: annotations on one line share one slot in order, so a finding
// keeps its place, and its open question, when a selection ends on its line.
function annotationsOf(notes: readonly LineNote[], selected: Extract<Annotation, { kind: "selection" }> | null): DiffLineAnnotation<Annotation>[] {
  const drawn = notes.map((note): DiffLineAnnotation<Annotation> => ({ side: pierreSideOf(note.at), lineNumber: note.at.line, metadata: { kind: "note", node: note.node } }));
  if (selected === null) return drawn;
  const last = refOf(selected.span.rows[selected.span.rows.length - 1]);
  return [...drawn, { side: pierreSideOf(last), lineNumber: last.line, metadata: selected }];
}
