import type { useSdk } from "@get-bb/plugin-sdk/app";
import type { ChangedFile, ChangesInput, GitPatch } from "./git.ts";

type FileRead = Awaited<ReturnType<ReturnType<typeof useSdk>["files"]["read"]>>;
export type ReadFile = Pick<FileRead, "content" | "contentEncoding" | "sizeBytes">;

type DiffSource =
  | { kind: "patch"; patch: GitPatch }
  | { kind: "fetch"; patchKey: string }
  | { kind: "notice"; message: string };

type SourceView = { kind: "source"; content: string } | { kind: "notice"; message: string };

const MAX_SOURCE_BYTES = 1024 * 1024;

export function diffSourceOf(file: ChangedFile, initialPatches: readonly GitPatch[], input: ChangesInput): DiffSource {
  if (file.binary) return { kind: "notice", message: "Binary file. There is no text diff to show." };
  if (file.loadMode === "too_large") {
    return { kind: "notice", message: `Too large to display (${file.additions + file.deletions} changed lines).` };
  }
  if (file.additions + file.deletions === 0) return { kind: "notice", message: unchangedContentsMessageOf(file) };
  const patch = initialPatches.find((candidate) => candidate.path === file.path);
  return patch === undefined ? { kind: "fetch", patchKey: patchKeyOf(input, file) } : { kind: "patch", patch };
}

function patchKeyOf(input: ChangesInput, file: ChangedFile): string {
  return JSON.stringify([input.environmentId, input.target, input.ignoreWhitespace, file.path, file.revision]);
}

export function sourceViewOf(file: ReadFile): SourceView {
  if (file.contentEncoding !== "utf8") return { kind: "notice", message: "Binary file. There is no text to show." };
  if (file.sizeBytes > MAX_SOURCE_BYTES) {
    return { kind: "notice", message: `Too large to display (${megabytesOf(file.sizeBytes)} MB).` };
  }
  return { kind: "source", content: file.content };
}

function unchangedContentsMessageOf(file: ChangedFile): string {
  return file.previousPath === null
    ? "No text changes."
    : `Renamed from ${file.previousPath}. The contents are unchanged.`;
}

function megabytesOf(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
