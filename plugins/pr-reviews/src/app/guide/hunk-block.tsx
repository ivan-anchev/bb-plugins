// One hunk of a step: a quiet file row above bb's diff, with each finding under its line. A
// collapsed hunk is only the row, with the agent's reason and Show; a file with no text hunks is
// the row with a one-line note.
import { useState, type ReactNode, type Ref } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import { hunkOf, WHOLE_FILE, type DiffFile, type HunkId } from "../../diff/diff-schema.ts";
import { hunkToPatch } from "../../diff/hunk-patch.ts";
import { interleaveFindings } from "../../guide/finding-segments.ts";
import type { GuideHunk } from "../../guide/guide-schema.ts";
import type { VisibleFinding } from "../../guide/walkthrough.ts";
import type { GuideTarget } from "../queries.ts";
import { Prose } from "../ui/prose.tsx";
import { ContinuationDiff } from "./continuation-diff.tsx";
import { FindingBlock } from "./finding-block.tsx";
import { ShowToggle } from "./show-toggle.tsx";

/**
 * `findings` are the hunk's findings the view options show; the guide they belong to is `target`.
 * `ref` is the block, which takes focus when the step's file list jumps to it.
 */
type HunkBlockProps = { file: DiffFile; entry: GuideHunk; findings: VisibleFinding[]; target: GuideTarget } & BlockRef;

export function HunkBlock({ file, entry, findings, target, ref }: HunkBlockProps) {
  if (entry.hunk === WHOLE_FILE) return <WholeFile file={file} ref={ref} />;
  const body = <AnnotatedDiff file={file} hunk={entry.hunk} findings={findings} target={target} />;
  if (entry.collapsed === null) return <OpenHunk path={file.path} body={body} ref={ref} />;
  return <CollapsedHunk path={file.path} reason={entry.collapsed} body={body} ref={ref} />;
}

/** A unit's body without its file row: bb's diff, the same component and theme as Code Explorer's, or the whole-file note. */
export function HunkDiff({ file, hunk }: { file: DiffFile; hunk: HunkId }) {
  if (hunk === WHOLE_FILE) return <p className="px-3 py-2.5 text-[12.5px] text-subtle-foreground">{wholeFileNoteOf(file)}</p>;
  return <Diff patch={hunkToPatch(hunkOf(file, hunk))} path={file.path} />;
}

// The only place that knows findings are drawn by splitting the hunk between experimental_Diff
// blocks: a hunk with no findings shown is one unsplit diff. The hunk opens with code, and code
// after a finding continues it, so it drops the separator a fresh diff would draw. When
// experimental_Diff takes line annotations, this becomes one <Diff> and nothing else changes.
function AnnotatedDiff({ file, hunk, findings, target }: { file: DiffFile; hunk: HunkId; findings: VisibleFinding[]; target: GuideTarget }) {
  if (findings.length === 0) return <HunkDiff file={file} hunk={hunk} />;
  return interleaveFindings(hunkOf(file, hunk), findings).map((segment, i) => {
    // Keyed by the finding, so its open question survives the findings around it changing.
    if (segment.kind === "finding") return <FindingBlock key={`finding ${segment.finding.index}`} shown={segment.finding} target={target} />;
    const Code = i === 0 ? Diff : ContinuationDiff;
    return <Code key={`code ${i}`} patch={hunkToPatch(segment.hunk)} path={file.path} />;
  });
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
