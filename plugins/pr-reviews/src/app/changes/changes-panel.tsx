// The Changes tab's panel (ported from code-explorer's changes-tree): the header over the file tree
// and the selected file's diff, side by side. The filters narrow the tree; the summary and the
// menus' counts stay the whole PR's. The selected file is remembered per PR.
//
// REVIEW.md, stable chrome: the header and the tree model are mounted from the first render, before
// the diff is read, so a header control focused or a menu opened while it loads stays focused or
// open when it arrives. Until then the panel shows the read's state in one region, and focus there
// moves to the diff pane that replaces it.
import { useMemo, type ReactNode } from "react";
import type { PrChanges } from "../../contract.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { PrTarget } from "../queries.ts";
import { Notice } from "../ui/notice.tsx";
import { useRememberedState } from "../use-remembered-state.ts";
import { changeSummaryOf } from "./change-stats.ts";
import { DiffViewer } from "./diff-viewer.tsx";
import { extensionCountsOf, filterChangedFiles, isFiltering, kindCountsOf } from "./file-filter.ts";
import { ChangesHeader } from "./header/changes-header.tsx";
import { ReadState, useFocusHandOff } from "./read-state.tsx";
import { SplitView } from "./split/split-view.tsx";
import { changesTreeOf } from "./tree/tree-input.ts";
import { TreeView, useTreeModel } from "./tree/tree-view.tsx";
import { useChangesControls } from "./use-changes-controls.ts";

/** `changes`: null until the diff is first read. `loading`: that first read is running. `readError`:
 *  a failed read, shown above the files it leaves in place. */
type ChangesPanelProps = { target: PrTarget; changes: PrChanges | null; loading: boolean; readError: ReactNode };

const NO_FILES: readonly DiffFile[] = [];

const rememberedSelections = new Map<string, string | null>();

export function ChangesPanel({ target, changes, loading, readError }: ChangesPanelProps) {
  const memoryKey = `${target.projectId}/${target.number}`;
  const controls = useChangesControls(memoryKey);
  const pathQuery = controls.pathQuery.value;
  const filters = controls.filters.value;
  const changedFiles = changes?.files ?? NO_FILES;
  const shownFiles = useMemo(() => filterChangedFiles(changedFiles, pathQuery, filters), [changedFiles, pathQuery, filters]);
  const tree = useMemo(() => changesTreeOf(shownFiles), [shownFiles]);
  const [selectedPath, setSelectedPath] = useRememberedState(rememberedSelections, memoryKey, null);
  const shownFile = selectedPath === null ? undefined : tree.filesByTreePath.get(selectedPath);
  const model = useTreeModel({
    memoryKey,
    paths: tree.paths,
    gitStatus: tree.gitStatus,
    icons: tree.icons,
    decorations: tree.decorations,
    selectedPath: shownFile === undefined ? null : selectedPath,
  });
  const focusHandOff = useFocusHandOff();
  const summary =
    changes === null
      ? loading ? "loading" : null
      : changeSummaryOf({ files: changes.files, shown: shownFiles, filtering: isFiltering(pathQuery, filters) });

  return (
    <>
      <ChangesHeader controls={controls} summary={summary} extensionCounts={extensionCountsOf(changedFiles)} kindCounts={kindCountsOf(changedFiles)} model={model} />
      {changes === null ? (
        <ReadState ref={focusHandOff.from}>
          {readError}
          {loading && <Notice>Loading changes…</Notice>}
        </ReadState>
      ) : (
        <>
          {readError}
          <SplitView
            tree={
              <>
                {shownFiles.length === 0 && <Notice>{changes.files.length === 0 ? "No changes." : "No files match the filter."}</Notice>}
                <TreeView model={model} label="Changed files" onSelectFile={setSelectedPath} />
              </>
            }
            viewer={<DiffViewer ref={focusHandOff.to} file={shownFile ?? null} projectId={target.projectId} headSha={changes.headSha} settings={controls.settings.value} />}
          />
        </>
      )}
    </>
  );
}
