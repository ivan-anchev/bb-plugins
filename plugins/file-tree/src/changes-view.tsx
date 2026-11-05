import { useMemo, type ReactNode } from "react";
import { experimental_useRpcKeyedQuery, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import {
  Footnote,
  Notice,
  SegmentedControl,
  SelectFilePrompt,
  SplitView,
  TabFrame,
  Toolbar,
  type SegmentOption,
} from "./chrome.tsx";
import { DiffViewer } from "./diff-viewer.tsx";
import { gitContract, type ChangeTarget, type ChangesInput } from "./git.ts";
import { changesTreeOf } from "./tree-input.ts";
import { TreeView } from "./tree-view.tsx";
import { useRememberedState } from "./hooks/use-remembered-state.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";

type Scope = ChangeTarget["type"];
type ChangesQuery = ReturnType<typeof useChangedFiles>;
type ChangesResponse = NonNullable<ChangesQuery["data"]>;
type AvailableChanges = Extract<ChangesResponse, { outcome: "available" }>;

const rememberedScopes = new Map<string, Scope>();
const rememberedSelections = new Map<string, string | null>();

export function ChangesView({ environmentId, viewSwitch }: { environmentId: string; viewSwitch: ReactNode }) {
  const mergeBaseBranch = useMergeBaseBranch(environmentId);
  const [scope, setScope] = useRememberedState(rememberedScopes, environmentId, "uncommitted");
  const input: ChangesInput = { environmentId, target: targetOf(scope, mergeBaseBranch), ignoreWhitespace: false };
  const changes = useChangedFiles(input);
  useRefetchOnShow(changes.refetch);

  return (
    <TabFrame>
      <Toolbar onRefresh={changes.refetch}>
        {viewSwitch}
        {mergeBaseBranch === null ? null : (
          <SegmentedControl label="Compare" options={scopeOptions(mergeBaseBranch)} value={scope} onChange={setScope} />
        )}
      </Toolbar>
      <ChangesBody changes={changes} input={input} />
    </TabFrame>
  );
}

function useMergeBaseBranch(environmentId: string): string | null {
  const { data } = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "status",
    keys: [environmentId],
  });
  const row = data?.[environmentId];
  return row?.outcome === "available" ? (row.workspace.mergeBase?.mergeBaseBranch ?? null) : null;
}

function useChangedFiles(input: ChangesInput) {
  return experimental_useRpcQuery({ pluginId: "bb--git", contract: gitContract, method: "files", input });
}

function targetOf(scope: Scope, mergeBaseBranch: string | null): ChangeTarget {
  return scope === "all" && mergeBaseBranch !== null ? { type: "all", mergeBaseBranch } : { type: "uncommitted" };
}

function scopeOptions(mergeBaseBranch: string): SegmentOption<Scope>[] {
  return [
    { value: "uncommitted", label: "Uncommitted", title: "Working tree changes against HEAD" },
    { value: "all", label: `Branch vs ${mergeBaseBranch}`, title: `All changes since ${mergeBaseBranch}` },
  ];
}

function ChangesBody({ changes, input }: { changes: ChangesQuery; input: ChangesInput }) {
  const { data, error, isLoading } = changes;
  return (
    <>
      {error === null ? null : <Notice tone="error">Could not read changes: {error.message}</Notice>}
      {isLoading ? <Notice>Loading changes…</Notice> : null}
      {data === undefined ? null : <ChangesResult result={data} input={input} />}
    </>
  );
}

function ChangesResult({ result, input }: { result: ChangesResponse; input: ChangesInput }) {
  switch (result.outcome) {
    case "not_applicable":
      return <Notice>{result.message}</Notice>;
    case "unavailable":
      return <Notice tone="error">{result.failure.message}</Notice>;
    case "available":
      return result.files.length === 0 ? (
        <Notice>No changes.</Notice>
      ) : (
        <ChangesTree changes={result} input={input} />
      );
  }
}

function ChangesTree({ changes, input }: { changes: AvailableChanges; input: ChangesInput }) {
  const tree = useMemo(() => changesTreeOf(changes.files), [changes.files]);
  const [selectedPath, setSelectedPath] = useRememberedState(rememberedSelections, input.environmentId, null);
  const shownFile = selectedPath === null ? undefined : tree.filesByTreePath.get(selectedPath);

  return (
    <SplitView
      tree={
        <>
          <TreeView
            label="Changed files"
            memoryKey={`changes:${input.environmentId}`}
            paths={tree.paths}
            gitStatus={tree.gitStatus}
            icons={tree.icons}
            initialExpansion="open"
            selectedPath={shownFile === undefined ? null : selectedPath}
            onSelectFile={setSelectedPath}
          />
          {changes.truncated ? <Footnote>Showing the first {changes.files.length} changed files.</Footnote> : null}
        </>
      }
      viewer={
        shownFile === undefined ? (
          <SelectFilePrompt />
        ) : (
          <DiffViewer file={shownFile} initialPatches={changes.initialPatches} input={input} />
        )
      }
    />
  );
}
