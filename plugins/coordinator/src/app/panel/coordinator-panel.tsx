// The nav panel: the list at its root, the New page at `new`, and a coordinating thread's memory at
// `memory/<id>`. Its title bar holds New.
import { experimental_Icon as Icon, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import type { CoordinatorId } from "../../model/role.ts";
import { MemoryPage } from "../memory/memory-page.tsx";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { CoordinatorList } from "./coordinator-list.tsx";
import { NewCoordinator } from "./new-coordinator.tsx";
import { memorySubPath, NEW_SUBPATH, PANEL_PATH, pageOf } from "./routes.ts";

export function CoordinatorPanel({ subPath }: PluginNavPanelProps) {
  const { openList, openMemory } = usePanelNavigation();
  // Each page's root hands focus to the next when focus was inside it as it left, so All, a row's
  // Memory button or anything else that unmounts with its page never drops focus (REVIEW.md).
  const focus = useFocusHandOff();
  const pageRoot = useCallback((root: HTMLElement | null) => {
    focus.to(root);
    return focus.from(root);
  }, [focus]);

  const page = pageOf(subPath);
  switch (page.kind) {
    case "new":
      return <NewCoordinator ref={pageRoot} onBack={openList} />;
    case "memory":
      return <MemoryPage key={page.coordinatorId} ref={pageRoot} coordinatorId={page.coordinatorId} onBack={openList} />;
    case "list":
      return <CoordinatorList ref={pageRoot} onOpenMemory={openMemory} />;
    default:
      return page satisfies never;
  }
}

/** The title bar's New, shown on the list only: each other page has its own primary action. */
export function NewButton({ subPath }: PluginNavPanelProps) {
  const { openNew } = usePanelNavigation();
  return pageOf(subPath).kind !== "list" ? null : (
    <Button variant="default" size="sm" onClick={openNew}>
      <Icon name="Plus" aria-hidden />
      New
    </Button>
  );
}

function usePanelNavigation() {
  const navigate = useBbNavigate();
  return {
    openNew: () => navigate.toPluginPanel(PANEL_PATH, { subPath: NEW_SUBPATH }),
    openList: () => navigate.toPluginPanel(PANEL_PATH),
    openMemory: (id: CoordinatorId) => navigate.toPluginPanel(PANEL_PATH, { subPath: memorySubPath(id) }),
  };
}
