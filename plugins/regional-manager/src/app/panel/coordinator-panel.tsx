// The nav panel: the list at its root, the New page at `new`, and a regional manager's board at
// `board/<id>` and its memory at `memory/<id>`. Its title bar holds New.
import { experimental_Icon as Icon, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import type { CoordinatorId } from "../../model/role.ts";
import { BoardPage } from "../board/board-page.tsx";
import { MemoryPage } from "../memory/memory-page.tsx";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { CoordinatorList } from "./coordinator-list.tsx";
import { NewCoordinator } from "./new-coordinator.tsx";
import { coordinatorSubPath, NEW_SUBPATH, PANEL_PATH, pageOf } from "./routes.ts";
// PROTOTYPE (i7) mount: the create-first picker. Revert this block and delete src/app/proto/.
import { PROTO_PREFIX, ProtoPage } from "../proto/proto-page.tsx";
// END PROTOTYPE (i7) mount

export function CoordinatorPanel({ subPath }: PluginNavPanelProps) {
  const { openList, openBoard, openMemory } = usePanelNavigation();
  // Each page's root hands focus to the next when focus was inside it as it left, so All, a row's
  // Memory button or anything else that unmounts with its page never drops focus (REVIEW.md).
  const focus = useFocusHandOff();
  const pageRoot = useCallback((root: HTMLElement | null) => {
    focus.to(root);
    return focus.from(root);
  }, [focus]);

  // PROTOTYPE (i7) mount
  if (subPath.split("/")[0] === PROTO_PREFIX) return <ProtoPage subPath={subPath} />;
  // END PROTOTYPE (i7) mount
  const page = pageOf(subPath);
  switch (page.kind) {
    case "new":
      return <NewCoordinator ref={pageRoot} onBack={openList} />;
    case "board":
      return <BoardPage key={page.coordinatorId} ref={pageRoot} coordinatorId={page.coordinatorId} onBack={openList} onOpenMemory={() => openMemory(page.coordinatorId)} />;
    case "memory":
      return <MemoryPage key={page.coordinatorId} ref={pageRoot} coordinatorId={page.coordinatorId} onBack={openList} />;
    case "list":
      return <CoordinatorList ref={pageRoot} onOpenBoard={openBoard} onOpenMemory={openMemory} />;
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
    openBoard: (id: CoordinatorId) => navigate.toPluginPanel(PANEL_PATH, { subPath: coordinatorSubPath("board", id) }),
    openMemory: (id: CoordinatorId) => navigate.toPluginPanel(PANEL_PATH, { subPath: coordinatorSubPath("memory", id) }),
  };
}
