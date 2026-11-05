import { useEffect, useImperativeHandle, type Ref } from "react";
import { experimental_Diff as Diff, experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import type { DiffSettings } from "./changes/use-changes-controls.ts";
import { Footnote, Notice, ViewerFrame } from "./chrome.tsx";
import { gitContract, type ChangedFile, type ChangesInput, type GitPatch, type PatchRow } from "./git.ts";
import { diffSourceOf } from "./viewer-input.ts";

export type DiffViewerHandle = { reread(): void };

type DiffPresentation = Pick<DiffSettings, "view" | "overflow">;

type DiffViewerProps = {
  file: ChangedFile;
  initialPatches: readonly GitPatch[];
  input: ChangesInput;
  presentation: DiffPresentation;
  ref: Ref<DiffViewerHandle>;
};

type FetchedPatchDiffProps = { patchKey: string; presentation: DiffPresentation; ref: Ref<DiffViewerHandle> };

export function DiffViewer({ file, initialPatches, input, presentation, ref }: DiffViewerProps) {
  return (
    <ViewerFrame path={file.path}>
      <ChangeDiff file={file} initialPatches={initialPatches} input={input} presentation={presentation} ref={ref} />
    </ViewerFrame>
  );
}

function ChangeDiff({ file, initialPatches, input, presentation, ref }: DiffViewerProps) {
  const source = diffSourceOf(file, initialPatches, input);
  switch (source.kind) {
    case "notice":
      return <Notice>{source.message}</Notice>;
    case "patch":
      return <PatchDiff patch={source.patch} presentation={presentation} />;
    case "fetch":
      return <FetchedPatchDiff patchKey={source.patchKey} presentation={presentation} ref={ref} />;
  }
}

function FetchedPatchDiff({ patchKey, presentation, ref }: FetchedPatchDiffProps) {
  const { row, error, isFetching, refetch } = useFetchedPatch(patchKey);
  useImperativeHandle(ref, () => ({ reread: refetch }), [refetch]);
  const settledError = isFetching ? null : error;
  const readError =
    settledError === null ? null : <Notice tone="error">Could not load the diff: {settledError.message}</Notice>;
  if (row === undefined) return readError ?? <Notice>Loading diff…</Notice>;
  return (
    <>
      {readError}
      <PatchRowDiff row={row} presentation={presentation} />
    </>
  );
}

function useFetchedPatch(patchKey: string) {
  const { data, error, isFetching, refetch, refetchKeys } = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "patches",
    keys: [patchKey],
  });
  useEffect(
    function rereadWhenShown() {
      refetchKeys([patchKey]);
    },
    [patchKey, refetchKeys],
  );
  return { row: data?.[patchKey], error, isFetching, refetch };
}

function PatchRowDiff({ row, presentation }: { row: PatchRow; presentation: DiffPresentation }) {
  switch (row.outcome) {
    case "available":
      return <PatchDiff patch={row.patch} presentation={presentation} />;
    case "not_applicable":
      return <Notice>{row.message}</Notice>;
    case "unavailable":
      return <Notice tone="error">{row.failure.message}</Notice>;
  }
}

function PatchDiff({ patch, presentation }: { patch: GitPatch; presentation: DiffPresentation }) {
  return (
    <>
      <Diff patch={patch.patch} path={patch.path} view={presentation.view} overflow={presentation.overflow} />
      {patch.truncated ? <Footnote>The diff is cut short.</Footnote> : null}
    </>
  );
}
