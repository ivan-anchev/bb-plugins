// The Changes tab's viewer (code-explorer's diff-viewer patch path): the selected file's path over
// its diff in the host's diff component, or a notice where the diff would be empty. The diff pane
// is the viewer's one scroll region and its one tab stop, in every state, the prompt included.
import type { ReactNode, Ref } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import type { DiffFile } from "../../diff/diff-schema.ts";
import { Notice } from "../ui/notice.tsx";
import { diffSourceOf } from "./diff-source.ts";
import type { DiffSettings } from "./use-changes-controls.ts";

/** `ref`: the diff pane, whichever file it shows. */
type DiffViewerProps = { ref: Ref<HTMLDivElement>; file: DiffFile | null; settings: DiffSettings };

export function DiffViewer({ ref, file, settings }: DiffViewerProps) {
  if (file === null) return <DiffPane ref={ref}><Notice>Select a file</Notice></DiffPane>;
  return (
    <>
      {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
      <p title={file.path} className="shrink-0 overflow-hidden text-ellipsis whitespace-pre border-b border-border px-3 py-1.5 font-mono text-xs text-muted-foreground">
        {file.path}
      </p>
      {/* Keyed: another file opens at its top. */}
      <DiffPane key={file.path} ref={ref}>
        <FileDiff file={file} settings={settings} />
      </DiffPane>
    </>
  );
}

function FileDiff({ file, settings }: { file: DiffFile; settings: DiffSettings }) {
  const source = diffSourceOf(file);
  switch (source.kind) {
    case "notice":
      return <Notice>{source.message}</Notice>;
    case "patch":
      return <Diff patch={source.patch} path={file.path} view={settings.view} overflow={settings.overflow} />;
    default:
      return source satisfies never;
  }
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
