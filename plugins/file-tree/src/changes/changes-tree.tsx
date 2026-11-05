import { useMemo, type ReactNode, type RefObject } from "react";
import { Footnote, Notice, SelectFilePrompt } from "../chrome.tsx";
import { DiffViewer, type DiffViewerHandle } from "../diff-viewer.tsx";
import type { AvailableChanges, ChangesInput } from "../git.ts";
import { useRememberedState } from "../hooks/use-remembered-state.ts";
import { SplitView } from "../split/split-view.tsx";
import { changesTreeOf } from "../tree-input.ts";
import { TreeView, useTreeModel } from "../tree-view.tsx";
import { changeSummaryOf } from "./change-stats.ts";
import { extensionCountsOf, filterChangedFiles, isFiltering } from "./file-filter.ts";
import { ChangesHeader } from "./header/changes-header.tsx";
import type { ChangesControls } from "./use-changes-controls.ts";

type ChangesTreeProps = {
  changes: AvailableChanges;
  input: ChangesInput;
  controls: ChangesControls;
  diff: RefObject<DiffViewerHandle | null>;
  refreshError: ReactNode;
};

const rememberedSelections = new Map<string, string | null>();

export function ChangesTree({ changes, input, controls, diff, refreshError }: ChangesTreeProps) {
  const pathQuery = controls.pathQuery.value;
  const filters = controls.filters.value;
  const shownFiles = useMemo(() => filterChangedFiles(changes.files, pathQuery, filters), [changes.files, pathQuery, filters]);
  const tree = useMemo(() => changesTreeOf(shownFiles), [shownFiles]);
  const [selectedPath, setSelectedPath] = useRememberedState(rememberedSelections, input.environmentId, null);
  const shownFile = selectedPath === null ? undefined : tree.filesByTreePath.get(selectedPath);
  const model = useTreeModel({
    memoryKey: `changes:${input.environmentId}`,
    paths: tree.paths,
    gitStatus: tree.gitStatus,
    icons: tree.icons,
    decorations: tree.decorations,
    initialExpansion: "open",
    selectedPath: shownFile === undefined ? null : selectedPath,
  });
  const openFile = (path: string) => {
    if (path === selectedPath) diff.current?.reread();
    setSelectedPath(path);
  };
  const summary = changeSummaryOf({
    shown: shownFiles,
    totalCount: changes.files.length,
    truncated: changes.truncated,
    filtering: isFiltering(pathQuery, filters),
  });

  return (
    <>
      <ChangesHeader
        controls={controls}
        summary={summary}
        extensionCounts={extensionCountsOf(changes.files)}
        model={model}
      />
      {refreshError}
      <SplitView
        tree={
          <>
            {shownFiles.length === 0 ? (
              <Notice>{changes.files.length === 0 ? "No changes." : "No files match the filter."}</Notice>
            ) : null}
            <TreeView model={model} label="Changed files" onSelectFile={openFile} />
            {changes.truncated ? <Footnote>Showing the first {changes.files.length} changed files.</Footnote> : null}
          </>
        }
        viewer={
          shownFile === undefined ? (
            <SelectFilePrompt />
          ) : (
            <DiffViewer
              file={shownFile}
              initialPatches={changes.initialPatches}
              input={input}
              presentation={controls.settings.value}
              ref={diff}
            />
          )
        }
      />
    </>
  );
}
