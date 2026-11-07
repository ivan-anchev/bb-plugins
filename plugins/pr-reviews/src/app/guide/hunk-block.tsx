// One hunk of a step: a quiet file row above bb's diff. A collapsed hunk is only the row, with
// the agent's reason and Show; a file with no text hunks is the row with a one-line note.
import { useState } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import { hunkOf, WHOLE_FILE, type DiffFile, type HunkId } from "../../diff/diff-schema.ts";
import { hunkToPatch } from "../../diff/hunk-patch.ts";
import type { GuideHunk } from "../../guide/guide-schema.ts";
import { Prose } from "../ui/prose.tsx";
import { ShowToggle } from "./show-toggle.tsx";

export function HunkBlock({ file, entry }: { file: DiffFile; entry: GuideHunk }) {
  if (entry.hunk === WHOLE_FILE) return <WholeFile file={file} />;
  if (entry.collapsed === null) return <OpenHunk file={file} hunk={entry.hunk} />;
  return <CollapsedHunk file={file} hunk={entry.hunk} reason={entry.collapsed} />;
}

/** A unit's body without its file row: bb's diff, the same component and theme as Code Explorer's, or the whole-file note. */
export function HunkDiff({ file, hunk }: { file: DiffFile; hunk: HunkId }) {
  if (hunk === WHOLE_FILE) return <p className="px-3 py-2.5 text-[12.5px] text-subtle-foreground">{wholeFileNoteOf(file)}</p>;
  return <Diff patch={hunkToPatch(hunkOf(file, hunk))} path={file.path} />;
}

const BLOCK = "overflow-hidden rounded-lg bg-muted/40";
const FILE_ROW = "flex items-baseline gap-3 px-3 pt-2.5 pb-2 text-[12.5px]";
const ROW_NOTE = "ml-auto text-right text-subtle-foreground";

function OpenHunk({ file, hunk }: { file: DiffFile; hunk: HunkId }) {
  return (
    <section className={BLOCK}>
      <p className={FILE_ROW}>
        <Path path={file.path} />
      </p>
      <HunkDiff file={file} hunk={hunk} />
    </section>
  );
}

function CollapsedHunk({ file, hunk, reason }: { file: DiffFile; hunk: HunkId; reason: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={BLOCK}>
      <div className={FILE_ROW}>
        <Path path={file.path} />
        <Prose text={reason} className={ROW_NOTE} />
        {/* The negative margins keep the row's height and line "Show" up with the row's edge. */}
        <div className="-my-1.5 -mr-1.5">
          <ShowToggle open={open} subject={file.path} onToggle={() => setOpen(!open)} />
        </div>
      </div>
      {open && <HunkDiff file={file} hunk={hunk} />}
    </section>
  );
}

function WholeFile({ file }: { file: DiffFile }) {
  return (
    <section className={BLOCK}>
      <p className={FILE_ROW}>
        <Path path={file.path} />
        <span className={ROW_NOTE}>{wholeFileNoteOf(file)}</span>
      </p>
    </section>
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
