import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { Notice, ViewerFrame } from "./chrome.tsx";
import { sourceViewOf, type ReadFile } from "./viewer-input.ts";
import { useFileContents } from "./hooks/use-file-contents.ts";

export function FileViewer({ environmentId, path }: { environmentId: string; path: string }) {
  return (
    <ViewerFrame path={path}>
      <FileContents environmentId={environmentId} path={path} />
    </ViewerFrame>
  );
}

function FileContents({ environmentId, path }: { environmentId: string; path: string }) {
  const state = useFileContents(environmentId, path);
  switch (state.status) {
    case "loading":
      return <Notice>Loading file…</Notice>;
    case "failed":
      return <Notice tone="error">Could not read the file: {state.message}</Notice>;
    case "ready":
      return <FileSource file={state.file} path={path} />;
  }
}

function FileSource({ file, path }: { file: ReadFile; path: string }) {
  const view = sourceViewOf(file);
  return view.kind === "source" ? <SourceCode content={view.content} path={path} /> : <Notice>{view.message}</Notice>;
}
