// One parent thread's row, Zeron's SessionRow: the agent's mark in a 30 slot, the project tile, the
// title fading out, its pull request, the subagents pill and the corner (an approval asked shows as one);
// tall, its detail on a second line.
// Right-click (or the Menu key) opens its menu; under the pointer the corner offers Archive, whatever the thread's state; a double-click or the menu's Rename renames it in place;
// the menu's Sleep ▸ Custom… opens the row's own dialog.
import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import { Root, Trigger } from "@radix-ui/react-context-menu";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useAsk } from "../../data/use-asks.ts";
import type { PullRequest } from "../../data/pull-request/github-pr-status.ts";
import { usePullRequest } from "../../data/pull-request/use-pull-request.ts";
import type { Corner as CornerModel, RowDetail, RowModel } from "../../model/activity.ts";
import type { RowMenu } from "../../model/row-menu.ts";
import { STATE_NAME, withAsk, type AskKind } from "../../model/state.ts";
import { CardGlyph } from "../card/card-glyphs.tsx";
import { Corner } from "../corner.tsx";
import { ProjectTile } from "../project-tile.tsx";
import { syncMinute } from "../../data/use-minute.ts";
import { SleepDialog } from "../sleep-dialog.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { RowMenuContent, useRowMenu, type RowSleep } from "./row-menu.tsx";
import { TitleEditor } from "./title-editor.tsx";

/** `tall`: a regular row, its detail on a second line under its title. */
export function Row({ row, tall, sleep, onNavigate }: { row: RowModel; tall: boolean; sleep: RowSleep; onNavigate(): void }) {
  const t = row.thread;
  const shortcut = useSidebarThreadShortcut(t.id);
  const { splitProps } = useSidebarThreadSplit(t.id);
  const link = useRef<HTMLAnchorElement>(null);
  const rename = useRename(link);
  const [sleepingCustom, setSleepingCustom] = useState(false);
  const menu = useRowMenu(row, sleep, { requestRename: rename.request, sleepCustom: () => setSleepingCustom(true) });
  const jump = shortcut?.label ?? null;
  const ask = useAsk(t);
  const corner = askedCorner(row.corner, ask);
  const pr = usePullRequest(t.environment?.id ?? null);

  const body = (title: ReactNode) => (
    <>
      <span className="as-slot">
        <span className="as-mark">
          <AgentMark providerId={t.providerId} />
        </span>
      </span>
      <span className="as-words">
        <span className="as-line">
          <span className="as-lead">
            <ProjectTile name={row.project.name} hue={row.project.hue} />
            {title}
          </span>
          {pr !== null && <PrBadge pr={pr} />}
          {row.runningUnder > 0 && (
            <span className="as-pill" title={`${row.runningUnder} running under it`} aria-hidden>
              <i />
              {row.runningUnder > 99 ? "99+" : row.runningUnder}
            </span>
          )}
          <Corner corner={corner} jump={jump} />
        </span>
        {tall && <DetailLine detail={row.detail} />}
      </span>
    </>
  );

  // why: the corner's button lies over the link, not in it, so pressing it never opens the thread.
  // why: the menu opens on the present minute, so Sleep's times are counted from now (Zeron reads the clock as it opens).
  // why: the dialog is the row's, so focus in it is the row's to the list: a row that leaves with its
  // sleep hands focus on to its heir, and one that stays takes it back when the dialog closes.
  return (
    <>
      <Root
        onOpenChange={(open) => {
          if (open) syncMinute();
        }}
      >
        <Trigger asChild disabled={rename.editing}>
          <div className="as-rowbox" data-jumping={jump === null ? undefined : ""}>
            {rename.editing ? (
              <div className="as-row" data-editing="" data-tall={tall || undefined} data-strong={row.strong || undefined} aria-current={row.current ? "page" : undefined}>
                {body(<TitleEditor threadId={t.id} title={t.displayTitle} onDone={rename.stop} />)}
              </div>
            ) : (
              // why: tabIndex -1: the scroller is the list's one tab stop and ↑/↓ move between rows.
              // The host routes a plain click on href in place; onNavigate closes the mobile drawer.
              <a
                ref={link}
                href={t.href}
                className="as-row"
                data-tall={tall || undefined}
                tabIndex={-1}
                data-strong={row.strong || undefined}
                aria-current={row.current ? "page" : undefined}
                aria-label={spoken(row, corner, pr)}
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
      <SleepDialog
        open={sleepingCustom}
        onOpenChange={setSleepingCustom}
        onSleep={(until) => {
          sleep.sleep(t.id, until);
          setSleepingCustom(false);
        }}
        onCloseAutoFocus={(event) => {
          // why: the dialog has no Trigger to return to. A row that left with its sleep has no link.
          event.preventDefault();
          link.current?.focus({ preventScroll: true });
        }}
      />
    </>
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
function CornerAction({ action }: { action: NonNullable<RowMenu["hoverAction"]> }) {
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

/** Regular's second line (Zeron's `SessionRow.second_line`): its branch's glyph leading while it has one, then where it runs and on what branch. */
function DetailLine({ detail }: { detail: RowDetail }) {
  return (
    <span className="as-detail">
      {detail.branch !== null && <CardGlyph name="branch" />}
      <FadingTitle text={detail.branch === null ? detail.where : `${detail.where} · ${detail.branch}`} />
    </span>
  );
}

/** The agent's artwork from bb's provider directory; bb's fallback glyph while it loads. */
export function AgentMark({ providerId }: { providerId: string }) {
  const { providers } = useProviders();
  const provider = providers.find((p) => p.id === providerId) ?? { id: providerId };
  return <ProviderIcon providerKind="agent" provider={provider} aria-hidden />;
}

/**
 * Text that doesn't fit fades out at its end, never cut to "…"; measured whenever its box resizes.
 * It carries how far it runs past its box, so a row's title can run through to its end under the pointer (app.css).
 */
export function FadingTitle({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [over, setOver] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setOver(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <span ref={ref} className="as-title" data-over={over > 0 || undefined} style={over > 0 ? runStyle(over) : undefined}>
      <span className="as-title-text">{text}</span>
    </span>
  );
}

/** The fade at a title's end, which its last words run past to read crisp. */
const FADE = 24;
/** How fast a title runs under the pointer, in px a second: slow enough to read as it moves. */
const RUN_SPEED = 45;

/** How far the title runs (its overflow and the fade) and for how long, for app.css's `.as-title-text`. */
function runStyle(over: number): CSSProperties & Record<"--as-travel" | "--as-run", string> {
  const travel = over + FADE;
  return { "--as-travel": `${travel}px`, "--as-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}

/** The corner once the row knows what its thread asks: an approval shows as one. */
function askedCorner(corner: CornerModel, ask: AskKind | null): CornerModel {
  return corner.kind === "state" ? { kind: "state", state: withAsk(corner.state, ask) } : corner;
}

/** "Fix the login flow, Working, bb-plugins, pull request 12, open, 2 running under it". */
function spoken(row: RowModel, corner: CornerModel, pr: PullRequest | null): string {
  const bits = [row.thread.displayTitle, spokenCorner(corner), row.project.name];
  // why: Zeron's badge label (Z:ds/locale_en.luau:334).
  if (pr !== null) bits.push(`pull request ${pr.number}, ${pr.state}`);
  if (row.runningUnder > 0) bits.push(`${row.runningUnder} running under it`);
  return bits.join(", ");
}

function spokenCorner(corner: CornerModel): string {
  switch (corner.kind) {
    case "state":
      return STATE_NAME[corner.state];
    case "wakes":
      return `wakes in ${corner.text}`;
    case "time":
      return corner.text === "now" ? "just now" : `${corner.text} ago`;
    default:
      corner satisfies never;
      return "";
  }
}
