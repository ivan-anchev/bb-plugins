import { useMemo, type ReactNode } from "react";
import { experimental_useRpcKeyedQuery, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { Footnote, Notice, SegmentedControl, TabFrame, Toolbar, type SegmentOption } from "./chrome.tsx";
import { gitContract, type ChangeTarget } from "./git.ts";
import { changesTreeOf } from "./tree-input.ts";
import { TreeView } from "./tree-view.tsx";
import { useOpenFile } from "./hooks/use-open-file.ts";
import { useRememberedState } from "./hooks/use-remembered-state.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";

type Scope = ChangeTarget["type"];
type ChangesQuery = ReturnType<typeof useChangedFiles>;
type ChangesResponse = NonNullable<ChangesQuery["data"]>;
type AvailableChanges = Extract<ChangesResponse, { outcome: "available" }>;

const rememberedScopes = new Map<string, Scope>();

export function ChangesView({ environmentId, viewSwitch }: { environmentId: string; viewSwitch: ReactNode }) {
  const mergeBaseBranch = useMergeBaseBranch(environmentId);
  const [scope, setScope] = useRememberedState(rememberedScopes, environmentId, "uncommitted");
  const changes = useChangedFiles(environmentId, targetOf(scope, mergeBaseBranch));
  useRefetchOnShow(changes.refetch);

  return (
    <TabFrame>
      <Toolbar onRefresh={changes.refetch}>
        {viewSwitch}
        {mergeBaseBranch === null ? null : (
          <SegmentedControl label="Compare" options={scopeOptions(mergeBaseBranch)} value={scope} onChange={setScope} />
        )}
      </Toolbar>
      <ChangesBody changes={changes} environmentId={environmentId} />
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

function useChangedFiles(environmentId: string, target: ChangeTarget) {
  return experimental_useRpcQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "files",
    input: { environmentId, target, ignoreWhitespace: false },
  });
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

function ChangesBody({ changes, environmentId }: { changes: ChangesQuery; environmentId: string }) {
  const { data, error, isLoading } = changes;
  return (
    <>
      {error === null ? null : <Notice tone="error">Could not read changes: {error.message}</Notice>}
      {isLoading ? <Notice>Loading changes…</Notice> : null}
      {data === undefined ? null : <ChangesResult result={data} environmentId={environmentId} />}
    </>
  );
}

function ChangesResult({ result, environmentId }: { result: ChangesResponse; environmentId: string }) {
  switch (result.outcome) {
    case "not_applicable":
      return <Notice>{result.message}</Notice>;
    case "unavailable":
      return <Notice tone="error">{result.failure.message}</Notice>;
    case "available":
      return result.files.length === 0 ? (
        <Notice>No changes.</Notice>
      ) : (
        <ChangesTree changes={result} environmentId={environmentId} />
      );
  }
}

function ChangesTree({ changes, environmentId }: { changes: AvailableChanges; environmentId: string }) {
  const tree = useMemo(() => changesTreeOf(changes.files), [changes.files]);
  const openFile = useOpenFile(environmentId);
  const openChange = (treePath: string) => {
    const file = tree.filesByTreePath.get(treePath);
    if (file !== undefined) openFile(file.path, file.changeKind === "deleted" ? (changes.mergeBaseRef ?? "HEAD") : undefined);
  };

  return (
    <>
      <TreeView
        label="Changed files"
        memoryKey={`changes:${environmentId}`}
        paths={tree.paths}
        gitStatus={tree.gitStatus}
        icons={tree.icons}
        initialExpansion="open"
        onOpenFile={openChange}
      />
      {changes.truncated ? <Footnote>Showing the first {changes.files.length} changed files.</Footnote> : null}
    </>
  );
}
