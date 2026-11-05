import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Footnote, Notice, SelectFilePrompt, SplitView, TabFrame, Toolbar } from "./chrome.tsx";
import { FileViewer } from "./file-viewer.tsx";
import { TREE_ICONS, treePathsOf, type WorkspacePath } from "./tree-input.ts";
import { TreeView } from "./tree-view.tsx";
import { useEnvironmentPaths, type EnvironmentPathsState } from "./hooks/use-environment-paths.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";
import { useRememberedState } from "./hooks/use-remembered-state.ts";

const rememberedSelections = new Map<string, string | null>();

export function AllFilesView({ environmentId, viewSwitch }: { environmentId: string; viewSwitch: ReactNode }) {
  const { state, refetch } = useEnvironmentPaths(environmentId);
  const [readCount, setReadCount] = useState(0);
  const refresh = useCallback(() => {
    refetch();
    setReadCount((count) => count + 1);
  }, [refetch]);
  useRefetchOnShow(refresh);

  return (
    <TabFrame>
      <Toolbar onRefresh={refresh}>{viewSwitch}</Toolbar>
      <AllFilesBody state={state} environmentId={environmentId} readCount={readCount} />
    </TabFrame>
  );
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

  return (
    <SplitView
      tree={
        <>
          <TreeView
            label="Environment files"
            memoryKey={`files:${environmentId}`}
            paths={paths}
            icons={TREE_ICONS}
            initialExpansion="closed"
            selectedPath={shownPath}
            onSelectFile={setSelectedPath}
          />
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
