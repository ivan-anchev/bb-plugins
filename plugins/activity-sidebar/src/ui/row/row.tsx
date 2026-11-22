import {
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useAsk } from "../../data/use-asks.ts";
import type { PullRequest } from "../../data/pull-request/github-pr-status.ts";
import { usePullRequest } from "../../data/pull-request/use-pull-request.ts";
import type { Corner as CornerModel, RowDetail, RowModel } from "../../model/activity.ts";
import { STATE_NAME, withAsk, type AskKind } from "../../model/state.ts";
import { CardGlyph } from "../card/card-glyphs.tsx";
import { Corner } from "../corner.tsx";
import { ProjectTile } from "../project-tile.tsx";
import { syncMinute } from "../../data/use-minute.ts";
import { SleepDialog } from "../sleep-dialog.tsx";
import { PrBadge } from "./pr-badge.tsx";
import { useRowActions, type RowActions, type RowSleep } from "./row-menu.tsx";
import { TitleEditor } from "./title-editor.tsx";

/** `tall`: a regular row, its detail on a second line under its title. */
export function Row({ row, tall, sleep, onNavigate }: { row: RowModel; tall: boolean; sleep: RowSleep; onNavigate(): void }) {
  const t = row.thread;
  const shortcut = useSidebarThreadShortcut(t.id);
  const { splitProps } = useSidebarThreadSplit(t.id);
  const link = useRef<HTMLAnchorElement>(null);
  const rename = useRename(link);
  const [sleepingCustom, setSleepingCustom] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const actions = useRowActions(row, sleep, () => setSleepingCustom(true));
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

  return (
    <>
      <ThreadActionsContextMenu
        thread={actions.target}
        inline={actions.inline}
        requestRename={rename.request}
        disabled={rename.editing}
        onCloseAutoFocus={rename.onCloseAutoFocus}
        onOpenChange={(open) => {
          if (open) syncMinute();
          setMenuOpen(open);
        }}
      >
        <div className="as-rowbox" data-jumping={jump === null ? undefined : ""} data-menu={menuOpen || undefined}>
          {rename.editing ? (
            <div className="as-row" data-editing="" data-tall={tall || undefined} data-strong={row.strong || undefined} aria-current={row.current ? "page" : undefined}>
              {body(<TitleEditor threadId={t.id} title={t.displayTitle} onDone={rename.stop} />)}
            </div>
          ) : (
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
              data-sidebar-thread-id={t.id}
              onClick={onNavigate}
              onDoubleClick={rename.start}
              onKeyDown={openMenuFromKeyboard}
              {...splitProps}
            >
              {body(<FadingTitle text={t.displayTitle} />)}
            </a>
          )}
          {actions.corner !== null && !rename.editing && <CornerAction action={actions.corner} />}
        </div>
      </ThreadActionsContextMenu>
      <SleepDialog
        open={sleepingCustom}
        onOpenChange={setSleepingCustom}
        onSleep={(until) => {
          sleep.sleep(t.id, until);
          setSleepingCustom(false);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          link.current?.focus({ preventScroll: true });
        }}
      />
    </>
  );
}

type Rename = { editing: boolean; start(): void; stop(byKey: boolean): void; request(): void; onCloseAutoFocus(event: Event): void };

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

function openMenuFromKeyboard(e: KeyboardEvent<HTMLAnchorElement>) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
  e.preventDefault();
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.bottom }));
}

function CornerAction({ action }: { action: NonNullable<RowActions["corner"]> }) {
  return (
    <button
      type="button"
      className="as-corner-action"
      tabIndex={-1}
      aria-label={action.label}
      title={action.label}
      aria-disabled={action.disabled || undefined}
      onClick={() => {
        if (!action.disabled) void action.run();
      }}
    >
      <Icon name={action.icon} aria-hidden />
    </button>
  );
}

function DetailLine({ detail }: { detail: RowDetail }) {
  const words = [detail.branch, detail.machine].filter((w) => w !== null);
  return (
    <span className="as-detail">
      {detail.branch !== null && <CardGlyph name="branch" />}
      {words.length > 0 && <FadingTitle text={words.join(" · ")} />}
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

const FADE = 24;
const RUN_SPEED = 45;

function runStyle(over: number): CSSProperties & Record<"--as-travel" | "--as-run", string> {
  const travel = over + FADE;
  return { "--as-travel": `${travel}px`, "--as-run": `${Math.round((travel / RUN_SPEED) * 1000)}ms` };
}

function askedCorner(corner: CornerModel, ask: AskKind | null): CornerModel {
  return corner.kind === "state" ? { kind: "state", state: withAsk(corner.state, ask) } : corner;
}

function spoken(row: RowModel, corner: CornerModel, pr: PullRequest | null): string {
  const bits = [row.thread.displayTitle, spokenCorner(corner), row.project.name];
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
