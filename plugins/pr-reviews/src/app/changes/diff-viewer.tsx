// The Changes tab's viewer (code-explorer's diff-viewer patch path): the selected file's path over
// its diff in the host's diff component, or a notice where the diff would be empty. The diff pane
// is the viewer's one scroll region and its one tab stop, in every state, the prompt included.
import { useMemo, type ReactNode, type Ref } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { oldContentOf } from "../../diff/old-content.ts";
import { useFileContent } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { diffSourceOf } from "./diff-source.ts";
import type { DiffSettings } from "./use-changes-controls.ts";

/** `ref`: the diff pane, whichever file it shows. `headSha`: the commit the PR's diff was read at. */
type DiffViewerProps = { ref: Ref<HTMLDivElement>; file: DiffFile | null; projectId: string; headSha: string; settings: DiffSettings };

export function DiffViewer({ ref, file, projectId, headSha, settings }: DiffViewerProps) {
  if (file === null) return <DiffPane ref={ref}><Notice>Select a file</Notice></DiffPane>;
  return (
    <>
      {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
      <p title={file.path} className="shrink-0 overflow-hidden text-ellipsis whitespace-pre border-b border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {file.path}
      </p>
      {/* Keyed: another file opens at its top. */}
      <DiffPane key={file.path} ref={ref}>
        <FileDiff file={file} projectId={projectId} headSha={headSha} settings={settings} />
      </DiffPane>
    </>
  );
}

type FileDiffProps = { file: DiffFile; projectId: string; headSha: string; settings: DiffSettings };

function FileDiff({ file, projectId, headSha, settings }: FileDiffProps) {
  const source = diffSourceOf(file);
  switch (source.kind) {
    case "notice":
      return <Notice>{source.message}</Notice>;
    case "patch":
      return <PatchDiff file={file} patch={source.patch} expandable={source.expandable} projectId={projectId} headSha={headSha} settings={settings} />;
    default:
      return source satisfies never;
  }
}

type PatchDiffProps = FileDiffProps & { patch: string; expandable: boolean };

// The patch draws at once. The file's text at the head arrives after, and with it the host's
// controls to expand the unchanged lines between hunks. A failed or refused read (a file over 1 MB)
// shows above the diff, which keeps drawing from the patch. Refresh and reselecting the file
// re-read it after a failure.
function PatchDiff({ file, patch, expandable, projectId, headSha, settings }: PatchDiffProps) {
  const content = useFileContent({ projectId, sha: headSha, path: file.path }, expandable);
  const newContent = content.data?.content;
  const fullFileContents = useMemo(() => (newContent === undefined ? undefined : fullFileContentsOf(file, newContent)), [file, newContent]);
  return (
    <>
      <ReadError read={content} what="this file's unchanged lines" />
      <Diff patch={patch} path={file.path} view={settings.view} overflow={settings.overflow} experimental_fullFileContents={fullFileContents} />
    </>
  );
}

// why one path on both sides, a rename's too: the host checks each side's name against the patch's,
// and our headerless patch names the file once, by `path`.
function fullFileContentsOf(file: DiffFile, newContent: string) {
  return { old: { path: file.path, content: oldContentOf(file, newContent) }, new: { path: file.path, content: newContent } };
}

// why a block, not a flex column: the host's diff would shrink to the pane as a flex item and scroll
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
