// One hunk of a step: a quiet file row above the hunk's diff, with each finding under its line. A
// collapsed hunk is only the row, with the agent's reason and Show; a file with no text hunks is
// the row with a one-line note.
import { useMemo, useState, type ReactNode, type Ref } from "react";
import { hunkOf, WHOLE_FILE, type DiffFile, type HunkId } from "../../diff/diff-schema.ts";
import type { GuideHunk } from "../../guide/guide-schema.ts";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import { DEFAULT_DIFF_SETTINGS } from "../diff/diff-options.ts";
import { PrDiff, type LineNote } from "../diff/pr-diff.tsx";
import type { PrHeadTarget } from "../queries.ts";
import { Prose } from "../ui/prose.tsx";
import { FindingBlock } from "./finding-block.tsx";
import { ShowToggle } from "./show-toggle.tsx";

/**
 * `findings` are the hunk's findings the view options show; the guide they belong to is at `head`.
 * `ref` is the block, which takes focus when the step's file list jumps to it.
 */
type HunkBlockProps = { file: DiffFile; entry: GuideHunk; findings: VisibleFinding[]; head: PrHeadTarget } & BlockRef;

export function HunkBlock({ file, entry, findings, head, ref }: HunkBlockProps) {
  if (entry.hunk === WHOLE_FILE) return <WholeFile file={file} ref={ref} />;
  const body = <AnnotatedDiff file={file} hunk={entry.hunk} findings={findings} head={head} />;
  if (entry.collapsed === null) return <OpenHunk path={file.path} body={body} ref={ref} />;
  return <CollapsedHunk path={file.path} reason={entry.collapsed} body={body} ref={ref} />;
}

/** A unit's body without its file row: the hunk's diff, or the whole-file note. The overview's hidden hunks. */
export function HunkDiff({ file, hunk, head }: { file: DiffFile; hunk: HunkId; head: PrHeadTarget }) {
  if (hunk === WHOLE_FILE) return <p className="px-3 py-2.5 text-[12.5px] text-subtle-foreground">{wholeFileNoteOf(file)}</p>;
  return <AnnotatedDiff file={file} hunk={hunk} findings={NO_FINDINGS} head={head} />;
}

const NO_FINDINGS: VisibleFinding[] = [];

// One diff of the hunk with each finding under its line; findings on one line keep their order. A
// guide has no file text to expand into, so the hunk's leading "N unmodified lines" stays shut.
function AnnotatedDiff({ file, hunk, findings, head }: { file: DiffFile; hunk: HunkId; findings: VisibleFinding[]; head: PrHeadTarget }) {
  const drawn = useMemo(() => ({ ...file, hunks: [hunkOf(file, hunk)] }), [file, hunk]);
  const notes = useMemo(
    () =>
      findings.map(
        // Keyed by the finding, so an open question never passes to another finding.
        (shown): LineNote => ({ at: { side: shown.finding.side, line: shown.finding.line }, node: <FindingBlock key={shown.index} shown={shown} file={drawn} head={head} /> }),
      ),
    [findings, drawn, head],
  );
  return <PrDiff file={drawn} head={head} newContent={null} settings={DEFAULT_DIFF_SETTINGS} notes={notes} />;
}

const FILE_ROW = "flex items-baseline gap-3 px-3 pt-2.5 pb-2 text-[12.5px]";
const ROW_NOTE = "ml-auto text-right text-subtle-foreground";

type BlockRef = { ref?: Ref<HTMLElement> };

// tabIndex -1: a jump from the step's file list focuses the block, which is not a tab stop. The
// scroll margin keeps the jump's landing clear of the page's top edge.
function Block({ ref, children }: BlockRef & { children: ReactNode }) {
  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="scroll-mt-[18px] overflow-hidden rounded-lg bg-muted/40 outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function WholeFile({ file, ref }: { file: DiffFile } & BlockRef) {
  return (
    <Block ref={ref}>
      <p className={FILE_ROW}>
        <Path path={file.path} />
        <span className={ROW_NOTE}>{wholeFileNoteOf(file)}</span>
      </p>
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
