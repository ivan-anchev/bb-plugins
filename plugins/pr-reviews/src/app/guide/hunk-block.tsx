import { useMemo, useState, type ReactNode, type Ref } from "react";
import { NO_THREADS, placeThreads, threadsOfUnit } from "../../comments/place-threads.ts";
import type { PrComments } from "../../comments/timeline-schema.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import { hunkOf, WHOLE_FILE, type DiffFile, type HunkId } from "../../diff/diff-schema.ts";
import type { GuideHunk } from "../../guide/guide-schema.ts";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import { DEFAULT_DIFF_SETTINGS } from "../diff/diff-options.ts";
import { PrDiff, type LineNote } from "../diff/pr-diff.tsx";
import { useComments, type PrHeadTarget } from "../queries.ts";
import { Prose } from "../ui/prose.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { FindingBlock } from "./finding-block.tsx";
import { ShowToggle } from "./show-toggle.tsx";
import { FILE_CARD, FileCard } from "../ui/file-card.tsx";

/**
 * `findings` are the hunk's findings the view options show; the guide they belong to is at `head`.
 * `comments`: the PR's comments once read, whose failed read the step shows. `withFileThreads`:
 * the block is its file's first in the step, so it also shows the file's threads that are on no
 * line of this diff. `ref` is the block, which takes focus when the step's file list jumps to it.
 */
type HunkBlockProps = {
  file: DiffFile;
  entry: GuideHunk;
  findings: VisibleFinding[];
  head: PrHeadTarget;
  comments: PrComments | undefined;
  withFileThreads: boolean;
} & BlockRef;

export function HunkBlock({ file, entry, findings, head, comments, withFileThreads, ref }: HunkBlockProps) {
  const body = <AnnotatedDiff file={file} hunk={entry.hunk} findings={findings} head={head} comments={comments} withFileThreads={withFileThreads} />;
  if (entry.hunk === WHOLE_FILE) return <WholeFile file={file} body={body} ref={ref} />;
  if (entry.collapsed === null) return <OpenHunk path={file.path} body={body} ref={ref} />;
  return <CollapsedHunk path={file.path} reason={entry.collapsed} body={body} ref={ref} />;
}

/**
 * A unit without its file header, in a file card of its own: the hunk's diff, or the whole-file note,
 * with their threads, and a failed read of the PR's comments above it. The overview's hidden hunks.
 */
export function HunkDiff({ file, hunk, head }: { file: DiffFile; hunk: HunkId; head: PrHeadTarget }) {
  const comments = useComments({ projectId: head.projectId, number: head.number });
  return (
    <>
      <ReadError read={comments} what="the PR's comments" />
      <div className={`${FILE_CARD} overflow-hidden`}>
        {hunk === WHOLE_FILE && <p className="px-3 py-2.5 text-xs text-subtle-foreground">{wholeFileNoteOf(file)}</p>}
        <AnnotatedDiff file={file} hunk={hunk} findings={NO_FINDINGS} head={head} comments={comments.data} withFileThreads={false} />
      </div>
    </>
  );
}

const NO_FINDINGS: VisibleFinding[] = [];

type AnnotatedDiffProps = { file: DiffFile; hunk: HunkId; findings: VisibleFinding[]; head: PrHeadTarget; comments: PrComments | undefined; withFileThreads: boolean };

function AnnotatedDiff({ file, hunk, findings, head, comments, withFileThreads }: AnnotatedDiffProps) {
  const drawn = useMemo(() => (hunk === WHOLE_FILE ? file : { ...file, hunks: [hunkOf(file, hunk)] }), [file, hunk]);
  const threads = useMemo(
    () => (comments === undefined ? NO_THREADS : threadsOfUnit(placeThreads(comments.threads, file.path, head.headSha, diffRowsOf(file, null)), file, hunk, withFileThreads)),
    [comments, file, hunk, head.headSha, withFileThreads],
  );
  const notes = useMemo(
    () =>
      findings.map(
        (shown): LineNote => ({ at: { side: shown.finding.side, line: shown.finding.line }, render: (openBox) => <FindingBlock shown={shown} openBox={openBox} /> }),
      ),
    [findings],
  );
  return (
    <div className={FLUSH_DIFF}>
      <PrDiff file={drawn} head={head} newContent={null} settings={DEFAULT_DIFF_SETTINGS} notes={notes} threads={threads} />
    </div>
  );
}

const FLUSH_DIFF = "[--diffs-gap-block:0px]";

const ROW_NOTE = "min-w-0 text-right font-normal text-subtle-foreground";

type BlockRef = { ref?: Ref<HTMLElement> };

function OpenHunk({ path, body, ref }: { path: string; body: ReactNode } & BlockRef) {
  return (
    <FileCard ref={ref} path={path}>
      {body}
    </FileCard>
  );
}

function CollapsedHunk({ path, reason, body, ref }: { path: string; reason: string; body: ReactNode } & BlockRef) {
  const [open, setOpen] = useState(false);
  const end = (
    <>
      <Prose text={reason} className={ROW_NOTE} />
      <span className="-my-1.5 -mr-1.5 shrink-0">
        <ShowToggle open={open} subject={path} onToggle={() => setOpen(!open)} />
      </span>
    </>
  );
  return (
    <FileCard ref={ref} path={path} end={end}>
      {open ? body : null}
    </FileCard>
  );
}

function WholeFile({ file, body, ref }: { file: DiffFile; body: ReactNode } & BlockRef) {
  return (
    <FileCard ref={ref} path={file.path} end={<span className={ROW_NOTE}>{wholeFileNoteOf(file)}</span>}>
      {body}
    </FileCard>
  );
}

function wholeFileNoteOf(file: DiffFile): string {
  if (file.binary) return file.previousPath === null ? "Binary file" : `Binary file, renamed from ${file.previousPath}`;
  if (file.previousPath !== null) return `Renamed from ${file.previousPath}`;
  switch (file.status) {
    case "added":
      return "New empty file";
    case "deleted":
      return "Deleted empty file";
    case "modified":
    case "renamed":
      return "Mode change only";
    default:
      return file.status satisfies never;
  }
}
