// The wide layout's PR sidebar and PR pane, split by a handle drawn as bb's own pane separator: a
// seam at rest that lights up under the pointer, while dragging and on keyboard focus. It drags,
// takes arrow keys, Home and End, and resets on double-click; the width is remembered across reloads.
// The width lives here, not in the panel, so a drag re-renders only the split: the sidebar and the
// pane arrive as elements and keep their identity while it moves.
import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { SIDEBAR_WIDTH, sidebarWidthAfterKey, useSidebarWidth } from "./sidebar-width.ts";

declare module "react" {
  interface CSSProperties {
    "--pr-reviews-sidebar-width"?: string;
  }
}

type SidebarSplitProps = {
  /** The sidebar's element id; it reads its wide width from `--pr-reviews-sidebar-width`. */
  sidebarId: string;
  sidebar: ReactNode;
  pane: ReactNode;
};

export function SidebarSplit({ sidebarId, sidebar, pane }: SidebarSplitProps) {
  const { width, resize, save } = useSidebarWidth();
  const style: CSSProperties = { "--pr-reviews-sidebar-width": `${width}px` };

  return (
    <div style={style} className="flex min-h-0 min-w-0 flex-1">
      {sidebar}
      <SidebarHandle sidebarId={sidebarId} width={width} onResize={resize} onSave={save} />
      {pane}
    </div>
  );
}

type SidebarHandleProps = {
  sidebarId: string;
  width: number;
  onResize(width: number): void;
  onSave(width: number): void;
};

/** Where the drag started, and the width its latest move asked for. */
type Drag = { pointer: number; startWidth: number; width: number };

function SidebarHandle({ sidebarId, width, onResize, onSave }: SidebarHandleProps) {
  const drag = useRef<Drag | null>(null);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.clientX, startWidth: width, width };
  };
  const followDrag = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    current.width = current.startWidth + event.clientX - current.pointer;
    onResize(current.width);
  };
  const endDrag = () => {
    const current = drag.current;
    if (current === null) return;
    drag.current = null;
    onSave(current.width);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = sidebarWidthAfterKey(event.key, width);
    if (next === null) return;
    event.preventDefault();
    onSave(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize pull request list"
      aria-controls={sidebarId}
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      onPointerDown={startDrag}
      onPointerMove={followDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={resizeByKey}
      onDoubleClick={() => onSave(SIDEBAR_WIDTH.default)}
      className="relative z-10 hidden w-px shrink-0 cursor-col-resize touch-none select-none bg-border-seam outline-none transition-[background-color] before:absolute before:inset-y-0 before:-inset-x-1.5 before:content-[''] hover:bg-ring/40 focus-visible:bg-ring active:bg-ring/40 motion-reduce:transition-none @3xl:block"
    />
  );
}
