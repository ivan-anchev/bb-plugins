// The Changes tab's file tree (ported from code-explorer's tree-view): a @pierre/trees model kept
// in step with the shown files, their icons, row decorations and the selected file, with folder
// expansion remembered for the session by `memoryKey`, and the tree element that draws it.
import { useEffect, useRef, type RefObject } from "react";
import type { FileTree as TreeModel, FileTreeIconConfig, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { expandedDirectoriesOf } from "./tree-expansion.ts";
import type { RowDecorations } from "./tree-input.ts";
import { keepOnlySelected } from "./tree-selection.ts";

type TreeModelOptions = {
  memoryKey: string;
  paths: readonly string[];
  gitStatus: readonly GitStatusEntry[];
  icons: FileTreeIconConfig;
  decorations: RowDecorations;
  selectedPath: string | null;
};

type TreeViewProps = { model: TreeModel; label: string; onSelectFile(path: string): void };

const rememberedExpansion = new Map<string, readonly string[]>();

export function useTreeModel({ memoryKey, paths, gitStatus, icons, decorations, selectedPath }: TreeModelOptions): TreeModel {
  const shownDecorations = useRef(decorations);
  const { model } = useFileTree({
    paths,
    gitStatus,
    ...expansionFor(memoryKey),
    initialSelectedPaths: selectedPath === null ? [] : [selectedPath],
    icons,
    renderRowDecoration: ({ item }) => shownDecorations.current.get(item.path) ?? null,
    density: "compact",
    flattenEmptyDirectories: true,
    search: false,
  });
  useRowPresentation(model, icons, decorations, shownDecorations);
  useSyncedPaths(model, paths, memoryKey);
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
      className="pr-reviews-file-tree min-h-0 flex-1"
      onClick={(event) => {
        const path = clickedFilePath(event.nativeEvent);
        if (path !== null) onSelectFile(path);
      }}
    />
  );
}

// Every folder starts open, until the reader has opened or closed one.
function expansionFor(memoryKey: string) {
  const remembered = rememberedExpansion.get(memoryKey);
  return remembered === undefined
    ? { initialExpansion: "open" as const }
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

// An empty tree, as before the diff is read or under a filter nothing matches, has no folders to
// remember, so it keeps the last expansion rather than forgetting it.
function useRememberedExpansion(model: TreeModel, memoryKey: string): void {
  useEffect(
    () =>
      model.subscribe(() => {
        if (model.getVisibleCount() > 0) rememberedExpansion.set(memoryKey, expandedDirectoriesOf(model));
      }),
    [model, memoryKey],
  );
}

function useSelectionOf(model: TreeModel, selectedPath: string | null): void {
  useEffect(() => keepOnlySelected(model, selectedPath), [model, selectedPath]);
}

function useSyncedPaths(model: TreeModel, paths: readonly string[], memoryKey: string): void {
  const appliedPaths = useRef(paths);

  useEffect(() => {
    if (samePaths(appliedPaths.current, paths)) return;
    appliedPaths.current = paths;
    model.resetPaths(paths, { initialExpandedPaths: expansionAfterReset(model, memoryKey) });
  }, [model, paths, memoryKey]);
}

// The folders open now carry over. An empty tree has none, so it takes the remembered ones, or with
// none remembered, `undefined` keeps the model's initial expansion: every folder open. A model built
// with every folder open reopens them all on each reset whatever this returns (as in Code Explorer).
function expansionAfterReset(model: TreeModel, memoryKey: string): readonly string[] | undefined {
  return model.getVisibleCount() === 0 ? rememberedExpansion.get(memoryKey) : expandedDirectoriesOf(model);
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
