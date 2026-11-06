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

/** Opens folders level by level, stopping below `maxDepth` (1 = top-level folders only). */
export function expandAllFolders(model: FileTree, maxDepth = Number.POSITIVE_INFINITY): void {
  const expanded = new Set<string>();
  const withinDepth = (path: string) => depthOf(path) <= maxDepth;
  let revealed = collapsedDirectoriesOf(model).filter(withinDepth);
  while (revealed.length > 0) {
    for (const path of revealed) {
      setFolderExpanded(model, path, true);
      expanded.add(path);
    }
    revealed = collapsedDirectoriesOf(model).filter((path) => withinDepth(path) && !expanded.has(path));
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

// "src/app/" is depth 2: one per path segment, with the trailing slash ignored.
function depthOf(directoryPath: string): number {
  return directoryPath.split("/").filter(Boolean).length;
}

function setFolderExpanded(model: FileTree, path: string, expanded: boolean): void {
  const item = model.getItem(path);
  if (item === null || !("expand" in item)) return;
  if (expanded) item.expand();
  else item.collapse();
}
