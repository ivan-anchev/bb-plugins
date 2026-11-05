import { useImperativeHandle, useRef, type Ref, type RefObject } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { ChangesTree } from "./changes/changes-tree.tsx";
import { ChangesHeader } from "./changes/header/changes-header.tsx";
import { useChangesControls, type ChangesControls } from "./changes/use-changes-controls.ts";
import { useWorkspaceStatus, type WorkspaceStatusState } from "./changes/use-workspace-status.ts";
import { Notice, type RefreshHandle } from "./chrome.tsx";
import type { DiffViewerHandle } from "./diff-viewer.tsx";
import { gitContract, type AvailableChanges, type ChangesInput, type WorkspaceStatus } from "./git.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";

type ChangesQuery = ReturnType<typeof useChangedFiles>;
type ChangesResponse = NonNullable<ChangesQuery["data"]>;
type ShownDiff = RefObject<DiffViewerHandle | null>;

type ChangesViewProps = { environmentId: string; ref: Ref<RefreshHandle> };

export function ChangesView({ environmentId, ref }: ChangesViewProps) {
  const status = useWorkspaceStatus(environmentId);
  return status.state.kind === "ready" ? (
    <WorkspaceChanges
      environmentId={environmentId}
      workspace={status.state.workspace}
      statusError={status.refreshError}
      refetchStatus={status.refetch}
      ref={ref}
    />
  ) : (
    <PendingWorkspace state={status.state} refetchStatus={status.refetch} ref={ref} />
  );
}

type PendingWorkspaceProps = {
  state: Exclude<WorkspaceStatusState, { kind: "ready" }>;
  refetchStatus(): void;
  ref: Ref<RefreshHandle>;
};

function PendingWorkspace({ state, refetchStatus, ref }: PendingWorkspaceProps) {
  useRefetchOnShow(refetchStatus);
  useImperativeHandle(ref, () => ({ refresh: refetchStatus }), [refetchStatus]);
  return state.kind === "loading" ? <Notice>Loading changes…</Notice> : <Notice tone={state.tone}>{state.message}</Notice>;
}

type WorkspaceChangesProps = ChangesViewProps & {
  workspace: WorkspaceStatus;
  statusError: string | null;
  refetchStatus(): void;
};

function WorkspaceChanges({ environmentId, workspace, statusError, refetchStatus, ref }: WorkspaceChangesProps) {
  const { controls, input } = useChangesControls(environmentId, workspace);
  const changes = useChangedFiles(input);
  const diff = useRef<DiffViewerHandle>(null);
  const refresh = () => {
    refetchStatus();
    changes.refetch();
    diff.current?.reread();
  };
  useRefetchOnShow(refresh);
  useImperativeHandle(ref, () => ({ refresh }));

  return (
    <>
      {statusError === null ? null : <Notice tone="error">Could not read the git status: {statusError}</Notice>}
      <ChangesBody changes={changes} input={input} controls={controls} diff={diff} />
    </>
  );
}

function useChangedFiles(input: ChangesInput) {
  return experimental_useRpcQuery({ pluginId: "bb--git", contract: gitContract, method: "files", input });
}

type ChangesBodyProps = { changes: ChangesQuery; input: ChangesInput; controls: ChangesControls; diff: ShownDiff };

function ChangesBody({ changes, input, controls, diff }: ChangesBodyProps) {
  const { data, error, isLoading } = changes;
  const refreshError = error === null ? null : <Notice tone="error">Could not read changes: {error.message}</Notice>;
  if (data?.outcome === "available") {
    return <ChangesTree changes={data} input={input} controls={controls} diff={diff} refreshError={refreshError} />;
  }
  return (
    <>
      <ChangesHeader controls={controls} summary={null} extensionCounts={[]} kindCounts={[]} model={null} />
      {refreshError}
      {isLoading ? <Notice>Loading changes…</Notice> : null}
      {data === undefined ? null : <UnavailableChanges result={data} />}
    </>
  );
}

function UnavailableChanges({ result }: { result: Exclude<ChangesResponse, AvailableChanges> }) {
  switch (result.outcome) {
    case "not_applicable":
      return <Notice>{result.message}</Notice>;
    case "unavailable":
      return <Notice tone="error">{result.failure.message}</Notice>;
  }
}
