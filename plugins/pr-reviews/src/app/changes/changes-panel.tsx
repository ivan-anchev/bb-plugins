// The Changes tab's panel (ported from code-explorer's changes-tree): the header over the file tree
// and the selected file's diff, side by side. The filters narrow the tree; the summary and the
// menus' counts stay the whole PR's. The selected file is remembered per PR.
//
// REVIEW.md, stable chrome: the header and the tree model are mounted from the first render, before
// the diff is read, so a header control focused or a menu opened while it loads stays focused or
// open when it arrives. Until then the panel shows the read's state in one region, and focus there
// moves to the diff pane that replaces it.
//
// A thread the reader asked to see from the Summary tab selects its file once the diff is read,
// clearing the filters if they hide it. Focus waits in the read's region or the diff pane until the
// thread takes it. A thread whose file has left the diff ends the request there, in the diff pane.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PrChanges } from "../../contract.ts";
import type { DiffFile } from "../../diff/diff-schema.ts";
import type { PrTarget } from "../queries.ts";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { mergeRefs } from "../ui/merge-refs.ts";
import { Notice } from "../ui/notice.tsx";
import { useRememberedState } from "../use-remembered-state.ts";
import { changeSummaryOf } from "./change-stats.ts";
import { DiffViewer } from "./diff-viewer.tsx";
import { extensionCountsOf, filterChangedFiles, isFiltering, kindCountsOf, NO_FILTERS } from "./file-filter.ts";
import { ChangesHeader } from "./header/changes-header.tsx";
import { ReadState } from "./read-state.tsx";
import { revealTargetOf } from "./reveal-target.ts";
import { SplitView } from "./split/split-view.tsx";
import { ThreadRevealProvider, type ThreadReveal } from "./thread-reveal.ts";
import { changesTreeOf } from "./tree/tree-input.ts";
import { TreeView, useTreeModel } from "./tree/tree-view.tsx";
import { useChangesControls } from "./use-changes-controls.ts";

/** `changes`: null until the diff is first read. `loading`: that first read is running. `readError`:
 *  a failed read, shown above the files it leaves in place. `reveal`: a thread to show, until
 *  `onRevealed`. */
type ChangesPanelProps = { target: PrTarget; changes: PrChanges | null; loading: boolean; readError: ReactNode; reveal: ThreadReveal | null; onRevealed(): void };

const NO_FILES: readonly DiffFile[] = [];

const rememberedSelections = new Map<string, string | null>();

export function ChangesPanel({ target, changes, loading, readError, reveal, onRevealed }: ChangesPanelProps) {
  const memoryKey = `${target.projectId}/${target.number}`;
  const controls = useChangesControls(memoryKey);
  const pathQuery = controls.pathQuery.value;
  const filters = controls.filters.value;
  const changedFiles = changes?.files ?? NO_FILES;
  const shownFiles = useMemo(() => filterChangedFiles(changedFiles, pathQuery, filters), [changedFiles, pathQuery, filters]);
  const tree = useMemo(() => changesTreeOf(shownFiles), [shownFiles]);
  const [selectedPath, setSelectedPath] = useRememberedState(rememberedSelections, memoryKey, null);
  // Set during render, so the file is selected in the render the diff arrives in.
  const [selectedFor, setSelectedFor] = useState(0);
  const revealing = reveal !== null && changes !== null && reveal.asked !== selectedFor ? { asked: reveal.asked, ...revealTargetOf(reveal.path, tree.filesByTreePath, changes.files) } : null;
  if (revealing !== null && revealing.kind !== "absent") {
    setSelectedFor(revealing.asked);
    if (revealing.kind === "filtered-out") {
      controls.pathQuery.onChange(null);
      controls.filters.onChange(NO_FILTERS);
    }
    setSelectedPath(revealing.treePath);
  }
  const unrevealable = revealing?.kind === "absent";
  useLayoutEffect(() => {
    if (unrevealable) onRevealed();
  }, [unrevealable, onRevealed]);
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
  const content = useRevealFocus(reveal);
  const readStateRef = useMemo(() => mergeRefs(focusHandOff.from, content), [focusHandOff, content]);
  const viewerRef = useMemo(() => mergeRefs(focusHandOff.to, content), [focusHandOff, content]);
  const revealRequest = useMemo(() => ({ reveal, onRevealed }), [reveal, onRevealed]);
  const summary =
    changes === null
      ? loading ? "loading" : null
      : changeSummaryOf({ files: changes.files, shown: shownFiles, filtering: isFiltering(pathQuery, filters) });

  return (
    <>
      <ChangesHeader controls={controls} summary={summary} extensionCounts={extensionCountsOf(changedFiles)} kindCounts={kindCountsOf(changedFiles)} model={model} />
      {changes === null ? (
        <ReadState ref={readStateRef}>
          {readError}
          {loading && <Notice>Loading changes…</Notice>}
        </ReadState>
      ) : (
        <ThreadRevealProvider value={revealRequest}>
          {readError}
          <SplitView
            tree={
              <>
                {shownFiles.length === 0 && <Notice>{changes.files.length === 0 ? "No changes." : "No files match the filter."}</Notice>}
                <TreeView model={model} label="Changed files" onSelectFile={setSelectedPath} />
              </>
            }
            viewer={<DiffViewer ref={viewerRef} file={shownFile ?? null} head={{ ...target, headSha: changes.headSha }} settings={controls.settings.value} />}
          />
        </ThreadRevealProvider>
      )}
    </>
  );
}

// why: the row the reader pressed is on the Summary tab, which hides as the Changes tab shows, and
// focus would drop to the page body (REVIEW.md). The panel's content region takes it, the read's
// region or the diff pane, until the thread is drawn and takes it in turn.
function useRevealFocus(reveal: ThreadReveal | null) {
  const content = useRef<HTMLElement | null>(null);
  const asked = reveal?.asked ?? null;
  useLayoutEffect(() => {
    if (asked !== null) content.current!.focus();
  }, [asked]);
  return useCallback((element: HTMLElement | null) => {
    content.current = element;
  }, []);
}
