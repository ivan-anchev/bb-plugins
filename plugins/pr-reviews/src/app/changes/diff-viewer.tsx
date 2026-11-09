// The Changes tab's viewer (code-explorer's diff-viewer patch path): the selected file's path over
// its diff, drawn like bb's own, or a notice where the diff would be empty. The diff pane is the
// viewer's one scroll region and its one tab stop, in every state, the prompt included.
import type { ReactNode, Ref } from "react";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { DiffSettings } from "../diff/diff-options.ts";
import { PrDiff, type LineNote } from "../diff/pr-diff.tsx";
import { useFileContent, type PrHeadTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { diffSourceOf } from "./diff-source.ts";

/** `ref`: the diff pane, whichever file it shows. `head`: the PR at the commit its diff was read at. */
type DiffViewerProps = { ref: Ref<HTMLDivElement>; file: DiffFile | null; head: PrHeadTarget; settings: DiffSettings };

export function DiffViewer({ ref, file, head, settings }: DiffViewerProps) {
  if (file === null) return <DiffPane ref={ref}><Notice>Select a file</Notice></DiffPane>;
  return (
    <>
      {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
      <p title={file.path} className="shrink-0 overflow-hidden text-ellipsis whitespace-pre border-b border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {file.path}
      </p>
      {/* Keyed: another file opens at its top. */}
      <DiffPane key={file.path} ref={ref}>
        <FileDiff file={file} head={head} settings={settings} />
      </DiffPane>
    </>
  );
}

type FileDiffProps = { file: DiffFile; head: PrHeadTarget; settings: DiffSettings };

function FileDiff({ file, head, settings }: FileDiffProps) {
  const source = diffSourceOf(file);
  switch (source.kind) {
    case "notice":
      return <Notice>{source.message}</Notice>;
    case "patch":
      return <PatchDiff file={file} expandable={source.expandable} head={head} settings={settings} />;
    default:
      return source satisfies never;
  }
}

const NO_NOTES: readonly LineNote[] = [];

// The patch draws at once. The file's text at the head arrives after, and with it the controls to
// expand the unchanged lines between hunks. A failed or refused read (a file over 1 MB) shows
// above the diff, which keeps drawing from the patch. Refresh and reselecting the file re-read it
// after a failure.
function PatchDiff({ file, expandable, head, settings }: FileDiffProps & { expandable: boolean }) {
  const content = useFileContent({ projectId: head.projectId, sha: head.headSha, path: file.path }, expandable);
  return (
    <>
      <ReadError read={content} what="this file's unchanged lines" />
      <PrDiff file={file} head={head} newContent={content.data?.content ?? null} settings={settings} notes={NO_NOTES} />
    </>
  );
}

// why a block, not a flex column: the diff would shrink to the pane as a flex item and scroll
// itself, out of reach of the pane's tab stop, since the keys scroll only the focused element and
// its ancestors. As a block it takes its full height and the pane scrolls it. The ring sits inside:
// the pane runs to the split's edges.
function DiffPane({ ref, children }: { ref: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Diff"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
    </div>
  );
}
