// The nav panel: the list at its root, and the New page at `new`. Its title bar holds New.
import { experimental_Icon as Icon, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { CoordinatorList } from "./coordinator-list.tsx";
import { NewCoordinator } from "./new-coordinator.tsx";
import { NEW_SUBPATH, PANEL_PATH } from "./routes.ts";

export function CoordinatorPanel({ subPath }: PluginNavPanelProps) {
  const { openList } = usePanelNavigation();
  // All unmounts with the New page, so the list it returns to takes its focus (REVIEW.md).
  const focus = useFocusHandOff();
  return subPath === NEW_SUBPATH ? <NewCoordinator ref={focus.from} onBack={openList} /> : <CoordinatorList ref={focus.to} />;
}

/** The title bar's New, shown everywhere but the New page. */
export function NewButton({ subPath }: PluginNavPanelProps) {
  const { openNew } = usePanelNavigation();
  return subPath === NEW_SUBPATH ? null : (
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
  };
}
