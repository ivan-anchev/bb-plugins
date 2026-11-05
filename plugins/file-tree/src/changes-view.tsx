import { useRef, type ReactNode, type RefObject } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { ChangesTree } from "./changes/changes-tree.tsx";
import { ChangesHeader } from "./changes/header/changes-header.tsx";
import { useChangesControls, type ChangesControls } from "./changes/use-changes-controls.ts";
import { useWorkspaceStatus, type WorkspaceStatusState } from "./changes/use-workspace-status.ts";
import { Notice, TabFrame, Toolbar } from "./chrome.tsx";
import type { DiffViewerHandle } from "./diff-viewer.tsx";
import { gitContract, type AvailableChanges, type ChangesInput, type WorkspaceStatus } from "./git.ts";
import { useRefetchOnShow } from "./hooks/use-refetch-on-show.ts";

type ChangesQuery = ReturnType<typeof useChangedFiles>;
type ChangesResponse = NonNullable<ChangesQuery["data"]>;
type ShownDiff = RefObject<DiffViewerHandle | null>;

type ChangesViewProps = { environmentId: string; viewSwitch: ReactNode };

export function ChangesView({ environmentId, viewSwitch }: ChangesViewProps) {
  const status = useWorkspaceStatus(environmentId);
  return status.state.kind === "ready" ? (
    <WorkspaceChanges
      environmentId={environmentId}
      workspace={status.state.workspace}
      statusError={status.refreshError}
      refetchStatus={status.refetch}
      viewSwitch={viewSwitch}
    />
  ) : (
    <PendingWorkspace state={status.state} refetchStatus={status.refetch} viewSwitch={viewSwitch} />
  );
}

type PendingWorkspaceProps = {
  state: Exclude<WorkspaceStatusState, { kind: "ready" }>;
  refetchStatus(): void;
  viewSwitch: ReactNode;
};

function PendingWorkspace({ state, refetchStatus, viewSwitch }: PendingWorkspaceProps) {
  useRefetchOnShow(refetchStatus);
  return (
    <TabFrame>
      <Toolbar onRefresh={refetchStatus}>{viewSwitch}</Toolbar>
      {state.kind === "loading" ? <Notice>Loading changes…</Notice> : <Notice tone={state.tone}>{state.message}</Notice>}
    </TabFrame>
  );
}

type WorkspaceChangesProps = ChangesViewProps & {
  workspace: WorkspaceStatus;
  statusError: string | null;
  refetchStatus(): void;
};

function WorkspaceChanges({ environmentId, workspace, statusError, refetchStatus, viewSwitch }: WorkspaceChangesProps) {
  const { controls, input } = useChangesControls(environmentId, workspace);
  const changes = useChangedFiles(input);
  const diff = useRef<DiffViewerHandle>(null);
  const refresh = () => {
    refetchStatus();
    changes.refetch();
    diff.current?.reread();
  };
  useRefetchOnShow(refresh);

  return (
    <TabFrame>
      <Toolbar onRefresh={refresh}>{viewSwitch}</Toolbar>
      {statusError === null ? null : <Notice tone="error">Could not read the git status: {statusError}</Notice>}
      <ChangesBody changes={changes} input={input} controls={controls} diff={diff} />
    </TabFrame>
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
      <ChangesHeader controls={controls} summary={null} extensionCounts={[]} model={null} />
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
