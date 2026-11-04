import { useMemo, type ReactNode } from "react";
import { Footnote, Notice, TabFrame, Toolbar } from "./chrome.tsx";
import { TREE_ICONS, treePathsOf, type WorkspacePath } from "./tree-input.ts";
import { TreeView } from "./tree-view.tsx";
import { useEnvironmentPaths, type EnvironmentPathsState } from "./hooks/use-environment-paths.ts";
import { useOpenFile } from "./hooks/use-open-file.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";

export function AllFilesView({ environmentId, viewSwitch }: { environmentId: string; viewSwitch: ReactNode }) {
  const { state, refetch } = useEnvironmentPaths(environmentId);
  useRefetchOnShow(refetch);

  return (
    <TabFrame>
      <Toolbar onRefresh={refetch}>{viewSwitch}</Toolbar>
      <AllFilesBody state={state} environmentId={environmentId} />
    </TabFrame>
  );
}

function AllFilesBody({ state, environmentId }: { state: EnvironmentPathsState; environmentId: string }) {
  switch (state.status) {
    case "loading":
      return <Notice>Loading files…</Notice>;
    case "failed":
      return <Notice tone="error">Could not list files: {state.message}</Notice>;
    case "ready":
      return state.paths.length === 0 ? (
        <Notice>This environment has no files.</Notice>
      ) : (
        <AllFilesTree entries={state.paths} truncated={state.truncated} environmentId={environmentId} />
      );
  }
}

type AllFilesTreeProps = { entries: WorkspacePath[]; truncated: boolean; environmentId: string };

function AllFilesTree({ entries, truncated, environmentId }: AllFilesTreeProps) {
  const paths = useMemo(() => treePathsOf(entries), [entries]);
  const openFile = useOpenFile(environmentId);

  return (
    <>
      <TreeView
        label="Environment files"
        memoryKey={`files:${environmentId}`}
        paths={paths}
        icons={TREE_ICONS}
        initialExpansion="closed"
        onOpenFile={openFile}
      />
      {truncated ? <Footnote>Showing the first {entries.length} paths.</Footnote> : null}
    </>
  );
}
