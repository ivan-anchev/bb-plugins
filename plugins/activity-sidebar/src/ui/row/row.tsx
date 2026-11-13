// One parent thread's row, Zeron's SessionRow: the agent's mark in a 30 slot, the project tile, the
// title fading out, the subagents pill and the corner. Right-click (or the Menu key) opens its menu;
// under the pointer the corner offers Archive, whatever the thread's state; a double-click or the menu's Rename renames it in place.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import { Root, Trigger } from "@radix-ui/react-context-menu";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { RowModel } from "../../model/activity.ts";
import type { MenuAction } from "../../model/row-menu.ts";
import { STATE_NAME } from "../../model/state.ts";
import { Corner } from "../corner.tsx";
import { ProjectTile } from "../project-tile.tsx";
import { RowMenuContent, useRowMenu } from "./row-menu.tsx";
import { TitleEditor } from "./title-editor.tsx";

export function Row({ row, onNavigate }: { row: RowModel; onNavigate(): void }) {
  const t = row.thread;
  const shortcut = useSidebarThreadShortcut(t.id);
  const { splitProps } = useSidebarThreadSplit(t.id);
  const link = useRef<HTMLAnchorElement>(null);
  const rename = useRename(link);
  const menu = useRowMenu(row, rename.request);
  const jump = shortcut?.label ?? null;

  const body = (title: ReactNode) => (
    <>
      <span className="as-slot">
        <span className="as-mark">
          <AgentMark providerId={t.providerId} />
        </span>
      </span>
      <span className="as-line">
        <span className="as-lead">
          <ProjectTile name={row.project.name} hue={row.project.hue} />
          {title}
        </span>
        {row.runningUnder > 0 && (
          <span className="as-pill" title={`${row.runningUnder} running under it`} aria-hidden>
            <i />
            {row.runningUnder > 99 ? "99+" : row.runningUnder}
          </span>
        )}
        <Corner corner={row.corner} jump={jump} />
      </span>
    </>
  );

  // why: the corner's button lies over the link, not in it, so pressing it never opens the thread.
  return (
    <Root>
      <Trigger asChild disabled={rename.editing}>
        <div className="as-rowbox" data-jumping={jump === null ? undefined : ""}>
          {rename.editing ? (
            <div className="as-row" data-editing="" data-strong={row.strong || undefined} aria-current={row.current ? "page" : undefined}>
              {body(<TitleEditor threadId={t.id} title={t.displayTitle} onDone={rename.stop} />)}
            </div>
          ) : (
            // why: tabIndex -1: the scroller is the list's one tab stop and ↑/↓ move between rows.
            // The host routes a plain click on href in place; onNavigate closes the mobile drawer.
            <a
              ref={link}
              href={t.href}
              className="as-row"
              tabIndex={-1}
              data-strong={row.strong || undefined}
              aria-current={row.current ? "page" : undefined}
              aria-label={spoken(row)}
              aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
              data-sidebar-thread-shortcut-target=""
              // why: bb's host assigns jump keys only to target anchors that also name their thread.
              data-sidebar-thread-id={t.id}
              onClick={onNavigate}
              onDoubleClick={rename.start}
              onKeyDown={openMenuFromKeyboard}
              {...splitProps}
            >
              {body(<FadingTitle text={t.displayTitle} />)}
            </a>
          )}
          {menu.hoverAction !== null && !rename.editing && <CornerAction action={menu.hoverAction} />}
        </div>
      </Trigger>
      <RowMenuContent entries={menu.entries} onCloseAutoFocus={rename.onCloseAutoFocus} />
    </Root>
  );
}

// ------------------------------------------------------------------ layer 2

type Rename = { editing: boolean; start(): void; stop(byKey: boolean): void; request(): void; onCloseAutoFocus(event: Event): void };

/**
 * Renaming in the row. A double-click starts at once. The menu's Rename starts once the menu has
 * closed, keeping the menu's focus return off the field, as bb's own list does. Ended by Enter or
 * Escape, focus goes back to the row so the keyboard keeps its place; ended by leaving, it stays where it went.
 */
function useRename(link: RefObject<HTMLAnchorElement | null>): Rename {
  const [editing, setEditing] = useState(false);
  const afterMenu = useRef(false);
  const refocus = useRef(false);

  useLayoutEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    link.current?.focus({ preventScroll: true });
  }, [editing, link]);

  return {
    editing,
    start: () => setEditing(true),
    stop: (byKey) => {
      refocus.current = byKey;
      setEditing(false);
    },
    request: () => {
      afterMenu.current = true;
    },
    onCloseAutoFocus: (event) => {
      if (!afterMenu.current) return;
      afterMenu.current = false;
      event.preventDefault();
      setEditing(true);
    },
  };
}

/**
 * The Menu key or Shift+F10 on a focused row opens its menu under the row's start, as a right-click
 * would. Radix's context menu opens only on `contextmenu`, which not every browser sends for these keys.
 */
function openMenuFromKeyboard(e: KeyboardEvent<HTMLAnchorElement>) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }));
}

/** Under the pointer, the corner's Archive (Unarchive on the shelf) in the same box. */
function CornerAction({ action }: { action: MenuAction }) {
  return (
    <button
      type="button"
      className="as-corner-action"
      tabIndex={-1}
      aria-label={action.label}
      title={action.label}
      aria-disabled={action.disabled || undefined}
      onClick={() => {
        if (!action.disabled) action.run();
      }}
    >
      <Icon name={action.icon} aria-hidden />
    </button>
  );
}

/** The agent's artwork from bb's provider directory; bb's fallback glyph while it loads. */
function AgentMark({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  const provider = providers.find((p) => p.id === providerId) ?? { id: providerId };
  return <ProviderIcon providerKind="agent" provider={provider} aria-hidden />;
}

/** Text that doesn't fit fades out at its end, never cut to "…"; measured whenever its box resizes. */
function FadingTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setOver(el.scrollWidth > el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span ref={ref} className="as-title" data-over={over || undefined}>
      {text}
    </span>
  );
}

/** "Fix the login flow, Working, bb-plugins, 2 running under it". */
function spoken(row: RowModel): string {
  const when = row.corner.kind === "state" ? STATE_NAME[row.corner.state] : row.corner.text === "now" ? "just now" : `${row.corner.text} ago`;
  const bits = [row.thread.displayTitle, when, row.project.name];
  if (row.runningUnder > 0) bits.push(`${row.runningUnder} running under it`);
  return bits.join(", ");
}
