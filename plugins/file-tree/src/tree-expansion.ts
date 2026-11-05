import type { FileTree, FileTreeVisibleRow } from "@pierre/trees";

export type FolderState = "none" | "collapsed" | "expanded";

export function folderStateOf(model: FileTree): FolderState {
  const folders = visibleFoldersOf(model);
  if (folders.length === 0) return "none";
  return folders.some((row) => row.isExpanded) ? "expanded" : "collapsed";
}

export function expandedDirectoriesOf(model: FileTree): string[] {
  return visibleFoldersOf(model)
    .filter((row) => row.isExpanded)
    .map((row) => row.path);
}

export function collapseAllFolders(model: FileTree): void {
  for (const path of expandedDirectoriesOf(model).reverse()) setFolderExpanded(model, path, false);
}

export function expandAllFolders(model: FileTree): void {
  const expanded = new Set<string>();
  let revealed = collapsedDirectoriesOf(model);
  while (revealed.length > 0) {
    for (const path of revealed) {
      setFolderExpanded(model, path, true);
      expanded.add(path);
    }
    revealed = collapsedDirectoriesOf(model).filter((path) => !expanded.has(path));
  }
}

function collapsedDirectoriesOf(model: FileTree): string[] {
  return visibleFoldersOf(model)
    .filter((row) => !row.isExpanded)
    .map((row) => row.path);
}

function visibleFoldersOf(model: FileTree): FileTreeVisibleRow[] {
  return model.getVisibleRows(0, model.getVisibleCount()).filter((row) => row.kind === "directory");
}

function setFolderExpanded(model: FileTree, path: string, expanded: boolean): void {
  const item = model.getItem(path);
  if (item === null || !("expand" in item)) return;
  if (expanded) item.expand();
  else item.collapse();
}
