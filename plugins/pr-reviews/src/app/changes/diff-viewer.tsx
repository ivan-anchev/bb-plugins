// The Changes tab's viewer (code-explorer's diff-viewer patch path): the selected file's path over
// its diff, drawn like bb's own with the file's review threads in it, or a notice where the diff
// would be empty, with the file's threads under it. The diff pane is the
// viewer's one scroll region and its one tab stop, in every state, the prompt included.
import { useMemo, type ReactNode, type Ref } from "react";
import { NO_THREADS, placeThreads, type PlacedThreads } from "../../comments/place-threads.ts";
import { diffRowsOf } from "../../diff/diff-rows.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { DiffSettings } from "../diff/diff-options.ts";
import { PrDiff, type LineNote } from "../diff/pr-diff.tsx";
import { useComments, useFileContent, type PrHeadTarget } from "../queries.ts";
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

// The PR's comments arrive after the diff draws, and with them the file's threads, whether or not
// the file has a text diff: a binary or rename-only file's are all at its file, under its notice.
// Placed on the hunks' rows, which every thread GitHub has on this commit is on, so expanding the
// unchanged lines moves none. A failed read shows above the tree and diff (changes-panel.tsx), and
// the diff keeps its last threads.
function FileDiff({ file, head, settings }: FileDiffProps) {
  const comments = useComments({ projectId: head.projectId, number: head.number });
  const threads = useMemo(
    () => (comments.data === undefined ? NO_THREADS : placeThreads(comments.data.threads, file.path, head.headSha, diffRowsOf(file, null))),
    [comments.data, file, head.headSha],
  );
  return <FileBody file={file} head={head} settings={settings} threads={threads} />;
}

function FileBody({ file, head, settings, threads }: FileDiffProps & { threads: PlacedThreads }) {
  const source = diffSourceOf(file);
  switch (source.kind) {
    case "notice":
      return (
        <>
          <Notice>{source.message}</Notice>
          <PrDiff file={file} head={head} newContent={null} settings={settings} notes={NO_NOTES} threads={threads} />
        </>
      );
    case "patch":
      return <PatchDiff file={file} expandable={source.expandable} head={head} settings={settings} threads={threads} />;
    default:
      return source satisfies never;
  }
}

const NO_NOTES: readonly LineNote[] = [];

type PatchDiffProps = FileDiffProps & { expandable: boolean; threads: PlacedThreads };

// The patch draws at once. The file's text at the head arrives after, and with it the controls to
// expand the unchanged lines between hunks. A failed or refused read (a file over 1 MB) shows
// above the diff, which keeps drawing from the patch. Refresh and reselecting the file re-read it
// after a failure.
function PatchDiff({ file, expandable, head, settings, threads }: PatchDiffProps) {
  const content = useFileContent({ projectId: head.projectId, sha: head.headSha, path: file.path }, expandable);
  return (
    <>
      <ReadError read={content} what="this file's unchanged lines" />
      <PrDiff file={file} head={head} newContent={content.data?.content ?? null} settings={settings} notes={NO_NOTES} threads={threads} />
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
