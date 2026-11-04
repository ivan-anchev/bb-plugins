import type { useSdk } from "@get-bb/plugin-sdk/app";
import { createFileTreeIconResolver, type FileTreeIconConfig, type GitStatus, type GitStatusEntry } from "@pierre/trees";
import type { ChangedFile } from "./git.ts";

type EnvironmentPaths = Awaited<ReturnType<ReturnType<typeof useSdk>["environments"]["paths"]>>;
export type WorkspacePath = Pick<EnvironmentPaths["paths"][number], "kind" | "path">;

export type ChangesTreeInput = {
  paths: string[];
  gitStatus: GitStatusEntry[];
  icons: FileTreeIconConfig;
  filesByTreePath: ReadonlyMap<string, ChangedFile>;
};

export const TREE_ICONS: FileTreeIconConfig = {
  set: "complete",
  colored: true,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
  },
};

const treeIconResolver = createFileTreeIconResolver(TREE_ICONS);

const ZERO_WIDTH_SPACE = "\u200b";

export function treePathsOf(entries: readonly WorkspacePath[]): string[] {
  return entries.map((entry) => (entry.kind === "directory" ? `${entry.path}/` : entry.path));
}

export function changesTreeOf(files: readonly ChangedFile[]): ChangesTreeInput {
  const filesByTreePath = filesByCollisionFreePath(files);
  const entries = [...filesByTreePath];

  return {
    paths: [...filesByTreePath.keys()],
    gitStatus: entries.map(([path, file]) => ({ path, status: gitStatusOf(file) })),
    icons: iconsKeepingOriginalNames(entries.filter(([treePath, file]) => treePath !== file.path)),
    filesByTreePath,
  };
}

function filesByCollisionFreePath(files: readonly ChangedFile[]): Map<string, ChangedFile> {
  const directories = new Set(files.flatMap((file) => ancestorDirectoriesOf(file.path)));
  const takenPaths = new Set([...directories, ...files.map((file) => file.path)]);
  return new Map(
    files.map((file) => [directories.has(file.path) ? claimUnusedPath(file.path, takenPaths) : file.path, file]),
  );
}

function ancestorDirectoriesOf(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function claimUnusedPath(path: string, takenPaths: Set<string>): string {
  let candidate = `${path}${ZERO_WIDTH_SPACE}`;
  while (takenPaths.has(candidate)) candidate += ZERO_WIDTH_SPACE;
  takenPaths.add(candidate);
  return candidate;
}

function iconsKeepingOriginalNames(renamed: readonly [string, ChangedFile][]): FileTreeIconConfig {
  const iconsByTreeName = renamed.map(([treePath, file]) => [
    baseNameOf(treePath),
    treeIconResolver.resolveIcon("file-tree-icon-file", file.path),
  ]);
  return { ...TREE_ICONS, byFileName: { ...TREE_ICONS.byFileName, ...Object.fromEntries(iconsByTreeName) } };
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function gitStatusOf(file: ChangedFile): GitStatus {
  if (file.origin === "untracked") return "untracked";
  switch (file.changeKind) {
    case "added":
    case "copied":
      return "added";
    case "modified":
    case "type_changed":
      return "modified";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
  }
}
