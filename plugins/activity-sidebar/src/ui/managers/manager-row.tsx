// A regional manager's row in the Managers view: its avatar, its name and its description, nothing
// else. A click opens its thread; right-click (or the Menu key) opens bb's own thread menu.
import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_useSidebarThreadSplit as useSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { ManagerModel } from "../../model/activity.ts";
import { FadingTitle, openMenuFromKeyboard } from "../row/row.tsx";
import { toActionTarget } from "../row/row-menu.tsx";
import { usePanelShown } from "../portal-scope.ts";
import { ManagerAvatar } from "./manager-avatar.tsx";

export function ManagerRow({ manager, onNavigate }: { manager: ManagerModel; onNavigate(): void }) {
  const t = manager.thread;
  const { splitProps } = useSidebarThreadSplit(t.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = usePanelShown();
  const spoken = manager.description === null ? t.displayTitle : `${t.displayTitle}, ${manager.description}`;

  // why: tabIndex -1: the list is one tab stop and ↑/↓ move between rows, as in the threads' list.
  // The host routes a plain click on href in place; onNavigate closes the mobile drawer.
  return (
    // why: bb's only way to close its menu from outside; with Managers hidden, it closes as every overlay does (portal-scope.ts).
    <ThreadActionsContextMenu thread={toActionTarget(t)} dragging={!shown} onOpenChange={setMenuOpen}>
      <a
        href={t.href}
        className="as-manager"
        tabIndex={-1}
        data-menu={menuOpen || undefined}
        data-bare={manager.description === null || undefined}
        aria-current={manager.current ? "page" : undefined}
        aria-label={spoken}
        onClick={onNavigate}
        onKeyDown={openMenuFromKeyboard}
        {...splitProps}
      >
        <span className="as-manager-face">
          <ManagerAvatar avatar={manager.avatar} />
        </span>
        <span className="as-manager-words">
          <FadingTitle text={t.displayTitle} />
          {manager.description !== null && <span className="as-manager-description">{manager.description}</span>}
        </span>
      </a>
    </ThreadActionsContextMenu>
  );
}
