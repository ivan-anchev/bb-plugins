import { useEffect, useRef } from "react";
import type { FileTree as TreeModel, FileTreeIconConfig, FileTreeInitialExpansion, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";

const rememberedExpansion = new Map<string, readonly string[]>();

type TreeViewProps = {
  label: string;
  memoryKey: string;
  paths: readonly string[];
  gitStatus?: readonly GitStatusEntry[];
  icons: FileTreeIconConfig;
  initialExpansion: FileTreeInitialExpansion;
  onOpenFile(path: string): void;
};

export function TreeView({ label, memoryKey, paths, gitStatus, icons, initialExpansion, onOpenFile }: TreeViewProps) {
  const { model } = useFileTree({
    paths,
    gitStatus,
    ...expansionFor(memoryKey, initialExpansion),
    icons,
    density: "compact",
    flattenEmptyDirectories: true,
    search: false,
  });
  useEffect(() => model.setIcons(icons), [model, icons]);
  useSyncedPaths(model, paths);
  useRememberedExpansion(model, memoryKey);
  useEffect(() => model.setGitStatus(gitStatus), [model, gitStatus]);

  return (
    <FileTree
      model={model}
      aria-label={label}
      className="file-tree min-h-0 flex-1"
      onClick={(event) => {
        const path = clickedFilePath(event.nativeEvent);
        if (path !== null) onOpenFile(path);
      }}
    />
  );
}

function expansionFor(memoryKey: string, initialExpansion: FileTreeInitialExpansion) {
  const remembered = rememberedExpansion.get(memoryKey);
  return remembered === undefined
    ? { initialExpansion }
    : { initialExpansion: "closed" as const, initialExpandedPaths: remembered };
}

function useRememberedExpansion(model: TreeModel, memoryKey: string): void {
  useEffect(
    () => model.subscribe(() => rememberedExpansion.set(memoryKey, expandedDirectoriesOf(model))),
    [model, memoryKey],
  );
}

function useSyncedPaths(model: TreeModel, paths: readonly string[]): void {
  const appliedPaths = useRef(paths);

  useEffect(() => {
    if (samePaths(appliedPaths.current, paths)) return;
    appliedPaths.current = paths;
    model.resetPaths(paths, { initialExpandedPaths: expandedDirectoriesOf(model) });
  }, [model, paths]);
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

function expandedDirectoriesOf(model: TreeModel): string[] {
  return model
    .getVisibleRows(0, model.getVisibleCount())
    .filter((row) => row.kind === "directory" && row.isExpanded)
    .map((row) => row.path);
}

function clickedFilePath(event: MouseEvent): string | null {
  const row = event
    .composedPath()
    .find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.type === "item");
  return row?.dataset.itemType === "file" ? (row.dataset.itemPath ?? null) : null;
}
