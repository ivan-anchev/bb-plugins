import type { FileTree as TreeModel } from "@pierre/trees";
import { useFileTreeSelector } from "@pierre/trees/react";
import { IconButton } from "../../ui/icon-button.tsx";
import { collapseAllFolders, expandAllFolders, folderStateOf } from "../tree/tree-expansion.ts";

export function CollapseAllButton({ model }: { model: TreeModel }) {
  const folders = useFileTreeSelector(model, folderStateOf);
  switch (folders) {
    case "none":
      return <IconButton icon="ChevronsUp" label="Collapse all folders" disabled />;
    case "collapsed":
      return <IconButton icon="ChevronsDown" label="Expand all folders" onClick={() => expandAllFolders(model)} />;
    case "expanded":
      return <IconButton icon="ChevronsUp" label="Collapse all folders" onClick={() => collapseAllFolders(model)} />;
    default:
      return folders satisfies never;
  }
}
