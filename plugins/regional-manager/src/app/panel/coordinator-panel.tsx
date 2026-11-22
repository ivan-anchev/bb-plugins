// The nav panel: the list at its root, the New page at `new`, the page of a regional manager not
// started yet at `board/<id>`, and where an issue link lands at `issue/<id>/<issue>`. Its title bar holds New, and bb's title bar names the regional manager open.
import { experimental_Icon as Icon, useBbNavigate, type ExperimentalPageTitle, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { useCallback } from "react";
import { PANEL_PATH } from "../../model/issue/link/issue-link.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { IssueLanding } from "../chat-links/issue-landing.tsx";
import { useManager } from "../profile/use-manager.ts";
import { Button } from "../ui/button.tsx";
import { useFocusHandOff } from "../ui/focus-hand-off.ts";
import { CoordinatorList } from "./coordinator-list.tsx";
import { ManagerPage } from "./manager/manager-page.tsx";
import { NewCoordinator } from "./new-coordinator.tsx";
import { managerSubPath, NEW_SUBPATH, pageOf } from "./routes.ts";

export function CoordinatorPanel({ subPath }: PluginNavPanelProps) {
  const { openList, openManager } = usePanelNavigation();
  // Each page's root hands focus to the next when focus was inside it as it left, so All, a row or
  // anything else that unmounts with its page never drops focus (REVIEW.md).
  const focus = useFocusHandOff();
  const pageRoot = useCallback((root: HTMLElement | null) => {
    focus.to(root);
    return focus.from(root);
  }, [focus]);

  const page = pageOf(subPath);
  switch (page.kind) {
    case "new":
      return <NewCoordinator ref={pageRoot} onBack={openList} onCreated={openManager} />;
    case "manager":
      return <ManagerPage key={page.coordinatorId} ref={pageRoot} coordinatorId={page.coordinatorId} onBack={openList} />;
    case "issue":
      return <IssueLanding key={`${page.link.coordinatorId}/${page.link.issueId}`} ref={pageRoot} link={page.link} onBack={openList} />;
    case "list":
      return <CoordinatorList ref={pageRoot} onOpen={openManager} />;
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

/** bb's title bar on a regional manager's page: its name, once read. */
export function usePageTitle({ subPath }: PluginNavPanelProps): ExperimentalPageTitle | null {
  const page = pageOf(subPath);
  const profile = useManager(page.kind === "manager" ? page.coordinatorId : null)?.profile ?? null;
  return profile === null ? null : { title: profile.name };
}

function usePanelNavigation() {
  const navigate = useBbNavigate();
  return {
    openNew: () => navigate.toPluginPanel(PANEL_PATH, { subPath: NEW_SUBPATH }),
    openList: () => navigate.toPluginPanel(PANEL_PATH),
    openManager: (id: CoordinatorId) => navigate.toPluginPanel(PANEL_PATH, { subPath: managerSubPath(id) }),
  };
}
