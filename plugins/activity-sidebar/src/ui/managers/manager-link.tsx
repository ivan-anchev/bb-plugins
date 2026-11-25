// What a manager's row and tile share: a link to its thread, one of the view's arrow-key stops (never a tab
// stop of its own), that opens bb's own thread menu on right-click or the Menu key, drags to a split,
// and makes its avatar follow the cursor while the pointer is on it.
import { experimental_ThreadActionsContextMenu as ThreadActionsContextMenu, experimental_useSidebarThreadSplit as useSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import { useState, type ReactNode } from "react";
import type { ManagerModel } from "../../model/activity.ts";
import { openMenuFromKeyboard } from "../row/row.tsx";
import { toActionTarget } from "../row/row-menu.tsx";
import { usePanelShown } from "../portal-scope.ts";
import { useFollowing, type Following } from "./use-following.ts";

type Props = { manager: ManagerModel; className: string; label: string; onNavigate(): void; children(following: Following): ReactNode };

export function ManagerLink({ manager, className, label, onNavigate, children }: Props) {
  const t = manager.thread;
  const { splitProps } = useSidebarThreadSplit(t.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const shown = usePanelShown();
  const { following, pointer } = useFollowing();

  // why: tabIndex -1: the list is one tab stop and the arrow keys move between its tiles and rows.
  // The host routes a plain click on href in place; onNavigate closes the mobile drawer.
  return (
    // why: bb's only way to close its menu from outside; with Managers hidden, it closes as every overlay does (portal-scope.ts).
    <ThreadActionsContextMenu thread={toActionTarget(t)} dragging={!shown} onOpenChange={setMenuOpen}>
      <a
        href={t.href}
        className={className}
        tabIndex={-1}
        data-menu={menuOpen || undefined}
        aria-current={manager.current ? "page" : undefined}
        aria-label={label}
        onClick={onNavigate}
        onKeyDown={openMenuFromKeyboard}
        {...pointer}
        {...splitProps}
      >
        {children(following)}
      </a>
    </ThreadActionsContextMenu>
  );
}
