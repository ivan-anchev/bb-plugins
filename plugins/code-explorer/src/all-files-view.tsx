import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { Footnote, Notice, SelectFilePrompt, type RefreshHandle } from "./chrome.tsx";
import { FileViewer } from "./file-viewer.tsx";
import { SplitView } from "./split/split-view.tsx";
import { TREE_ICONS, treePathsOf, type WorkspacePath } from "./tree-input.ts";
import { TreeView, useTreeModel } from "./tree-view.tsx";
import { useEnvironmentPaths, type EnvironmentPathsState } from "./hooks/use-environment-paths.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";
import { useRememberedState } from "./hooks/use-remembered-state.ts";

const rememberedSelections = new Map<string, string | null>();

export function AllFilesView({ environmentId, ref }: { environmentId: string; ref: Ref<RefreshHandle> }) {
  const { state, refetch } = useEnvironmentPaths(environmentId);
  const [readCount, setReadCount] = useState(0);
  const refresh = useCallback(() => {
    refetch();
    setReadCount((count) => count + 1);
  }, [refetch]);
  useRefetchOnShow(refresh);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  return <AllFilesBody state={state} environmentId={environmentId} readCount={readCount} />;
}

type AllFilesBodyProps = { state: EnvironmentPathsState; environmentId: string; readCount: number };

function AllFilesBody({ state, environmentId, readCount }: AllFilesBodyProps) {
  switch (state.status) {
    case "loading":
      return <Notice>Loading files…</Notice>;
    case "failed":
      return <Notice tone="error">Could not list files: {state.message}</Notice>;
    case "ready":
      return state.paths.length === 0 ? (
        <Notice>This environment has no files.</Notice>
      ) : (
        <AllFilesTree
          entries={state.paths}
          truncated={state.truncated}
          environmentId={environmentId}
          readCount={readCount}
        />
      );
  }
}

type AllFilesTreeProps = { entries: WorkspacePath[]; truncated: boolean; environmentId: string; readCount: number };

function AllFilesTree({ entries, truncated, environmentId, readCount }: AllFilesTreeProps) {
  const paths = useMemo(() => treePathsOf(entries), [entries]);
  const [selectedPath, setSelectedPath] = useRememberedState(rememberedSelections, environmentId, null);
  const shownPath = selectedPath !== null && paths.includes(selectedPath) ? selectedPath : null;
  const model = useTreeModel({
    memoryKey: `files:${environmentId}`,
    paths,
    icons: TREE_ICONS,
    initialExpansion: "closed",
    selectedPath: shownPath,
  });

  return (
    <SplitView
      tree={
        <>
          <TreeView model={model} label="Environment files" onSelectFile={setSelectedPath} />
          {truncated ? <Footnote>Showing the first {entries.length} paths.</Footnote> : null}
        </>
      }
      viewer={
        shownPath === null ? (
          <SelectFilePrompt />
        ) : (
          <FileViewer key={`${shownPath}:${readCount}`} environmentId={environmentId} path={shownPath} />
        )
      }
    />
  );
}
