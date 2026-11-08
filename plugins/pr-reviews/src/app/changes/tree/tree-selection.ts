// Keeps exactly the selected file selected in the tree, whatever the tree's own clicks do (from code-explorer).
import type { FileTree } from "@pierre/trees";

export function keepOnlySelected(model: FileTree, path: string | null): () => void {
  let reconciling = false;
  const reconcile = () => {
    if (reconciling) return;
    reconciling = true;
    selectOnly(model, path);
    reconciling = false;
  };
  const unsubscribe = model.subscribe(reconcile);
  reconcile();
  return unsubscribe;
}

function selectOnly(model: FileTree, path: string | null): void {
  for (const selected of model.getSelectedPaths()) {
    if (selected !== path) model.getItem(selected)?.deselect();
  }
  const item = path === null ? null : model.getItem(path);
  if (item !== null && !item.isSelected()) item.select();
}
