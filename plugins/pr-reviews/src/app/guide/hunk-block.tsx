// One hunk of a step: a quiet file row above the hunk's diff, with each finding and review thread
// under its line. A collapsed hunk is only the row, with the agent's reason and Show; a file with
// no text hunks is the row with a one-line note, over the file's threads.
import { useMemo, useState, type ReactNode, type Ref } from "react";
import { NO_THREADS, placeThreads, threadsOfUnit } from "../../comments/place-threads.ts";
import type { PrComments } from "../../comments/thread-schema.ts";
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
 * A unit without its file row, on its own tinted surface: the hunk's diff, or the whole-file note,
 * with their threads, and a failed read of the PR's comments above it. The overview's hidden hunks.
 */
export function HunkDiff({ file, hunk, head }: { file: DiffFile; hunk: HunkId; head: PrHeadTarget }) {
  const comments = useComments({ projectId: head.projectId, number: head.number });
  return (
    <>
      {/* Above the surface, not on it: the error text passes contrast on the page, not on muted. */}
      <ReadError read={comments} what="the PR's comments" />
      <div className="overflow-hidden rounded-lg bg-muted/40">
        {hunk === WHOLE_FILE && <p className="px-3 py-2.5 text-[12.5px] text-subtle-foreground">{wholeFileNoteOf(file)}</p>}
        <AnnotatedDiff file={file} hunk={hunk} findings={NO_FINDINGS} head={head} comments={comments.data} withFileThreads={false} />
      </div>
    </>
  );
}

const NO_FINDINGS: VisibleFinding[] = [];

type AnnotatedDiffProps = { file: DiffFile; hunk: HunkId; findings: VisibleFinding[]; head: PrHeadTarget; comments: PrComments | undefined; withFileThreads: boolean };

// One diff of the hunk with each finding, then each review thread, under its line; findings on one
// line keep their order. A guide has no file text to expand into, so the hunk's leading "N
// unmodified lines" stays shut. Threads are placed on the whole file's rows, so one on another
// hunk of the file belongs to that hunk's block, not to this one's file threads. The whole-file
// unit of a file with no text hunks draws no diff, only the file's threads.
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

// A guide's diff has no band of the code's background above its first row and below its last.
const FLUSH_DIFF = "[--diffs-gap-block:0px]";

// The file row stays at the top of the guide's page while its diff scrolls under it, on the
// block's own tint made opaque (bg-muted/40 over the page).
const FILE_ROW =
  "sticky top-0 z-10 flex items-baseline gap-3 bg-[color-mix(in_srgb,var(--muted)_40%,var(--background))] px-3 pt-2.5 pb-2 text-[12.5px]";
const ROW_NOTE = "ml-auto text-right text-subtle-foreground";

type BlockRef = { ref?: Ref<HTMLElement> };

// tabIndex -1: a jump from the step's file list focuses the block, which is not a tab stop. The
// scroll margin keeps the jump's landing clear of the page's top edge, and anything in the block
// that scrolls into view, such as a focused button, clear of the sticky file row.
// why overflow-clip, not hidden: hidden makes the block a scroll container, and the file row would
// stick inside it, which never scrolls, rather than in the page.
function Block({ ref, children }: BlockRef & { children: ReactNode }) {
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="scroll-mt-[18px] overflow-clip rounded-lg bg-muted/40 outline-none focus-visible:ring-1 focus-visible:ring-ring [&_*]:scroll-mt-12"
    >
      {children}
    </section>
  );
}

function OpenHunk({ path, body, ref }: { path: string; body: ReactNode } & BlockRef) {
  return (
    <Block ref={ref}>
      <p className={FILE_ROW}>
        <Path path={path} />
      </p>
      {body}
    </Block>
  );
}

function CollapsedHunk({ path, reason, body, ref }: { path: string; reason: string; body: ReactNode } & BlockRef) {
  const [open, setOpen] = useState(false);
  return (
    <Block ref={ref}>
      <div className={FILE_ROW}>
        <Path path={path} />
        <Prose text={reason} className={ROW_NOTE} />
        {/* The negative margins keep the row's height and line "Show" up with the row's edge. */}
        <div className="-my-1.5 -mr-1.5">
          <ShowToggle open={open} subject={path} onToggle={() => setOpen(!open)} />
        </div>
      </div>
      {open && body}
    </Block>
  );
}

function WholeFile({ file, body, ref }: { file: DiffFile; body: ReactNode } & BlockRef) {
  return (
    <Block ref={ref}>
      <p className={FILE_ROW}>
        <Path path={file.path} />
        <span className={ROW_NOTE}>{wholeFileNoteOf(file)}</span>
      </p>
      {body}
    </Block>
  );
}

const Path = ({ path }: { path: string }) => <span className="min-w-0 break-all font-mono font-semibold">{path}</span>;

// What changed in a file that has no text hunks: binary content, a rename, or an empty or
// mode-only change.
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
