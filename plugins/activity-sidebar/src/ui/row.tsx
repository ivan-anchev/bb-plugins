// One parent thread's row, Zeron's SessionRow: the agent's mark in a 30 slot, the project tile, the
// title fading out, the subagents pill and the corner.
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders as useProviders,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  useSidebarThreadShortcut,
} from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef, useState } from "react";
import type { RowModel } from "../model/activity.ts";
import { STATE_NAME } from "../model/state.ts";
import { Corner } from "./corner.tsx";
import { ProjectTile } from "./project-tile.tsx";

export function Row({ row, onNavigate }: { row: RowModel; onNavigate(): void }) {
  const t = row.thread;
  const shortcut = useSidebarThreadShortcut(t.id);
  const { splitProps } = useSidebarThreadSplit(t.id);

  // why: tabIndex -1: the scroller is the list's one tab stop and ↑/↓ move between rows.
  // The host routes a plain click on href in place; onNavigate closes the mobile drawer.
  return (
    <a
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
      {...splitProps}
    >
      <span className="as-slot">
        <span className="as-mark">
          <AgentMark providerId={t.providerId} />
        </span>
      </span>
      <span className="as-line">
        <span className="as-lead">
          <ProjectTile name={row.project.name} hue={row.project.hue} />
          <FadingTitle text={t.displayTitle} />
        </span>
        {row.runningUnder > 0 && (
          <span className="as-pill" title={`${row.runningUnder} running under it`} aria-hidden>
            <i />
            {row.runningUnder > 99 ? "99+" : row.runningUnder}
          </span>
        )}
        <Corner corner={row.corner} jump={shortcut?.label ?? null} />
      </span>
    </a>
  );
}

// ------------------------------------------------------------------ layer 2

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
