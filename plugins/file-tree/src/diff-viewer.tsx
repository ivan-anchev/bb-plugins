import { experimental_Diff as Diff, experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { Footnote, Notice, ViewerFrame } from "./chrome.tsx";
import { gitContract, type ChangedFile, type ChangesInput, type GitPatch } from "./git.ts";
import { diffSourceOf } from "./viewer-input.ts";

type DiffViewerProps = { file: ChangedFile; initialPatches: readonly GitPatch[]; input: ChangesInput };

export function DiffViewer({ file, initialPatches, input }: DiffViewerProps) {
  return (
    <ViewerFrame path={file.path}>
      <ChangeDiff file={file} initialPatches={initialPatches} input={input} />
    </ViewerFrame>
  );
}

function ChangeDiff({ file, initialPatches, input }: DiffViewerProps) {
  const source = diffSourceOf(file, initialPatches, input);
  switch (source.kind) {
    case "notice":
      return <Notice>{source.message}</Notice>;
    case "patch":
      return <PatchDiff patch={source.patch} />;
    case "fetch":
      return <FetchedPatchDiff patchKey={source.patchKey} />;
  }
}

function FetchedPatchDiff({ patchKey }: { patchKey: string }) {
  const { data, error } = experimental_useRpcKeyedQuery({
    pluginId: "bb--git",
    contract: gitContract,
    method: "patches",
    keys: [patchKey],
  });
  const row = data?.[patchKey];
  if (row === undefined) {
    return error === null ? (
      <Notice>Loading diff…</Notice>
    ) : (
      <Notice tone="error">Could not load the diff: {error.message}</Notice>
    );
  }
  switch (row.outcome) {
    case "available":
      return <PatchDiff patch={row.patch} />;
    case "not_applicable":
      return <Notice>{row.message}</Notice>;
    case "unavailable":
      return <Notice tone="error">{row.failure.message}</Notice>;
  }
}

function PatchDiff({ patch }: { patch: GitPatch }) {
  return (
    <>
      <Diff patch={patch.patch} path={patch.path} />
      {patch.truncated ? <Footnote>The diff is cut short.</Footnote> : null}
    </>
  );
}
