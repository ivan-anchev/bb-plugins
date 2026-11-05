import { useEffect, useRef, type RefObject } from "react";
import type { FileTree as TreeModel, FileTreeIconConfig, FileTreeInitialExpansion, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { expandedDirectoriesOf } from "./tree-expansion.ts";
import type { RowDecorations } from "./tree-input.ts";
import { keepOnlySelected } from "./tree-selection.ts";

type TreeModelOptions = {
  memoryKey: string;
  paths: readonly string[];
  gitStatus?: readonly GitStatusEntry[];
  icons: FileTreeIconConfig;
  decorations?: RowDecorations;
  initialExpansion: FileTreeInitialExpansion;
  selectedPath: string | null;
};

type TreeViewProps = { model: TreeModel; label: string; onSelectFile(path: string): void };

const rememberedExpansion = new Map<string, readonly string[]>();

const NO_DECORATIONS: RowDecorations = new Map();

export function useTreeModel({
  memoryKey,
  paths,
  gitStatus,
  icons,
  decorations = NO_DECORATIONS,
  initialExpansion,
  selectedPath,
}: TreeModelOptions): TreeModel {
  const shownDecorations = useRef(decorations);
  const { model } = useFileTree({
    paths,
    gitStatus,
    ...expansionFor(memoryKey, initialExpansion),
    initialSelectedPaths: selectedPath === null ? [] : [selectedPath],
    icons,
    renderRowDecoration: ({ item }) => shownDecorations.current.get(item.path) ?? null,
    density: "compact",
    flattenEmptyDirectories: true,
    search: false,
  });
  useRowPresentation(model, icons, decorations, shownDecorations);
  useSyncedPaths(model, paths);
  useRememberedExpansion(model, memoryKey);
  useEffect(() => model.setGitStatus(gitStatus), [model, gitStatus]);
  useSelectionOf(model, selectedPath);
  return model;
}

export function TreeView({ model, label, onSelectFile }: TreeViewProps) {
  return (
    <FileTree
      model={model}
      aria-label={label}
      className="file-tree min-h-0 flex-1"
      onClick={(event) => {
        const path = clickedFilePath(event.nativeEvent);
        if (path !== null) onSelectFile(path);
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

function useRowPresentation(
  model: TreeModel,
  icons: FileTreeIconConfig,
  decorations: RowDecorations,
  shownDecorations: RefObject<RowDecorations>,
): void {
  useEffect(
    function redrawRows() {
      shownDecorations.current = decorations;
      model.setIcons(icons);
    },
    [model, icons, decorations, shownDecorations],
  );
}

function useRememberedExpansion(model: TreeModel, memoryKey: string): void {
  useEffect(
    () => model.subscribe(() => rememberedExpansion.set(memoryKey, expandedDirectoriesOf(model))),
    [model, memoryKey],
  );
}

function useSelectionOf(model: TreeModel, selectedPath: string | null): void {
  useEffect(() => keepOnlySelected(model, selectedPath), [model, selectedPath]);
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

function clickedFilePath(event: MouseEvent): string | null {
  const row = event
    .composedPath()
    .find((target): target is HTMLElement => target instanceof HTMLElement && target.dataset.type === "item");
  return row?.dataset.itemType === "file" ? (row.dataset.itemPath ?? null) : null;
}
