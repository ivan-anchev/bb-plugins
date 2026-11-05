import type { FileTree as TreeModel } from "@pierre/trees";
import { useFileTreeSelector } from "@pierre/trees/react";
import { collapseAllFolders, expandAllFolders, folderStateOf } from "../../tree-expansion.ts";
import { IconButton } from "../../ui/icon-button.tsx";

export function CollapseAllButton({ model }: { model: TreeModel }) {
  const folders = useFileTreeSelector(model, folderStateOf);
  switch (folders) {
    case "none":
      return <DisabledCollapseButton reason="No folders to collapse" />;
    case "collapsed":
      return <IconButton icon="ChevronsDown" label="Expand all folders" onClick={() => expandAllFolders(model)} />;
    case "expanded":
      return <IconButton icon="ChevronsUp" label="Collapse all folders" onClick={() => collapseAllFolders(model)} />;
  }
}

export function DisabledCollapseButton({ reason }: { reason?: string }) {
  return <IconButton icon="ChevronsUp" label="Collapse all folders" title={reason} disabled />;
}
