// Every diff the plugin draws: one PR file, or one hunk of it, at the commit the page shows, in
// bb's host-shared Pierre diff with bb's theme. Things drawn under a line, such as a guide's
// findings, come in as notes.
import { useMemo, type ReactNode } from "react";
import type { DiffLineAnnotation } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { LineRef } from "../../comments/comment-schema.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { PrHeadTarget } from "../queries.ts";
import { DiffErrorBoundary } from "./diff-error-boundary.tsx";
import { DIFF_TEXT_CLASS, fileDiffOf, useDiffOptions, type DiffSettings } from "./diff-options.ts";

/** Something drawn under a line, such as a finding card. */
export type LineNote = { at: LineRef; node: ReactNode };

type PrDiffProps = {
  /** The file with the hunks to draw: all of them on the Changes tab, one in a guide step. */
  file: DiffFile;
  /** The PR and the commit this diff is at. */
  head: PrHeadTarget;
  /** The file's text at `head.headSha` once read, or null: with it the unchanged lines expand. */
  newContent: string | null;
  settings: DiffSettings;
  /** Several notes on one line draw in their order. */
  notes: readonly LineNote[];
};

type Annotation = { kind: "note"; node: ReactNode };

export function PrDiff(props: PrDiffProps) {
  // Keyed by the file: a different file starts with a clean boundary.
  return (
    <DiffErrorBoundary key={props.file.path}>
      <NotedDiff {...props} />
    </DiffErrorBoundary>
  );
}

function NotedDiff({ file, newContent, settings, notes }: PrDiffProps) {
  const options = useDiffOptions<Annotation>(settings);
  const fileDiff = useMemo(() => fileDiffOf(file, newContent), [file, newContent]);
  const annotations = useMemo(() => notes.map(annotationOf), [notes]);
  return (
    <FileDiff<Annotation>
      className={DIFF_TEXT_CLASS}
      fileDiff={fileDiff}
      options={options}
      lineAnnotations={annotations}
      renderAnnotation={(annotation) => <div className={NOTE_TEXT}>{annotation.metadata.node}</div>}
    />
  );
}

// why: a note is slotted into the diff's rows and would inherit their code font, `white-space:
// pre` and the code theme's colour; it reads as the page's text.
const NOTE_TEXT = "font-sans whitespace-normal text-foreground";

// Pierre's sides are the diff's columns: deletions is the old side, additions the new.
const annotationOf = (note: LineNote): DiffLineAnnotation<Annotation> => ({
  side: note.at.side === "old" ? "deletions" : "additions",
  lineNumber: note.at.line,
  metadata: { kind: "note", node: note.node },
});
