// The Changes tab's resizable tree and viewer (ported from code-explorer's split-view): side by side
// from a 48rem container, stacked below it, with a divider that drags and takes arrow keys, Home
// and End. Sizes are remembered for the session.
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useRememberedState } from "../../use-remembered-state.ts";
import {
  DEFAULT_TREE_SIZES,
  MIN_TREE_SIZE,
  MIN_VIEWER_SIZE,
  clampedTreeSize,
  treeSizeAfterKey,
  treeSizeRangeOf,
  type SplitAxis,
  type TreeSizeRange,
  type TreeSizes,
} from "./split-size.ts";

declare module "react" {
  interface CSSProperties {
    "--tree-row-basis"?: string;
    "--tree-column-basis"?: string;
  }
}

type FrameRef = RefObject<HTMLDivElement | null>;

type Drag = { pointer: number; size: number; containerSize: number };

type FrameSize = Record<SplitAxis, number>;

const rememberedSizes = new Map<string, TreeSizes>();

const DIVIDER_CLASSES: Record<SplitAxis, string> = {
  row: "hidden w-px cursor-col-resize before:inset-y-0 before:-inset-x-1 @3xl:block",
  column: "h-px cursor-row-resize before:inset-x-0 before:-inset-y-1 @3xl:hidden",
};

export function SplitView({ tree, viewer }: { tree: ReactNode; viewer: ReactNode }) {
  const [sizes, setSizes] = useRememberedState(rememberedSizes, "tree", DEFAULT_TREE_SIZES);
  const frame = useRef<HTMLDivElement>(null);
  const frameSize = useFrameSize(frame);
  const treeId = useId();
  const resize = (axis: SplitAxis, size: number) => setSizes({ ...sizes, [axis]: size });

  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div
        ref={frame}
        style={{ "--tree-row-basis": basisOf(sizes.row), "--tree-column-basis": basisOf(sizes.column) }}
        className="flex min-h-0 flex-1 flex-col @3xl:flex-row"
      >
        <div
          id={treeId}
          className="flex min-h-0 min-w-0 shrink-0 grow-0 basis-(--tree-column-basis) flex-col @3xl:basis-(--tree-row-basis)"
        >
          {tree}
        </div>
        {(["column", "row"] as const).map((axis) => (
          <SplitDivider
            key={axis}
            axis={axis}
            range={frameSize === null ? null : treeSizeRangeOf(sizes[axis], frameSize[axis])}
            frame={frame}
            treeId={treeId}
            onResize={(size) => resize(axis, size)}
          />
        ))}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{viewer}</div>
      </div>
    </div>
  );
}

type SplitDividerProps = {
  axis: SplitAxis;
  range: TreeSizeRange | null;
  frame: FrameRef;
  treeId: string;
  onResize(size: number): void;
};

function SplitDivider({ axis, range, frame, treeId, onResize }: SplitDividerProps) {
  const drag = useRef<Drag | null>(null);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: pointerOf(event, axis), ...measure(event.currentTarget, frame, axis) };
  };
  const followDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) return;
    onResize(clampedTreeSize(start.size + pointerOf(event, axis) - start.pointer, start.containerSize));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const shown = measure(event.currentTarget, frame, axis);
    const next = treeSizeAfterKey(event.key, axis, shown.size, shown.containerSize);
    if (next === null) return;
    event.preventDefault();
    onResize(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize file tree"
      aria-controls={treeId}
      aria-orientation={axis === "row" ? "vertical" : "horizontal"}
      aria-valuemin={range?.min}
      aria-valuemax={range?.max}
      aria-valuenow={range?.now}
      onPointerDown={startDrag}
      onPointerMove={followDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={resizeByKey}
      className={`relative z-10 shrink-0 touch-none select-none bg-border outline-none transition-colors duration-150 before:absolute before:content-[''] hover:bg-ring focus-visible:bg-ring active:bg-ring ${DIVIDER_CLASSES[axis]}`}
    />
  );
}

function useFrameSize(frame: FrameRef): FrameSize | null {
  const [size, setSize] = useState<FrameSize | null>(null);

  useLayoutEffect(
    function followFrameSize() {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) setSize({ row: entry.contentRect.width, column: entry.contentRect.height });
      });
      observer.observe(mountedFrameOf(frame));
      return () => observer.disconnect();
    },
    [frame],
  );

  return size;
}

function basisOf(size: number): string {
  return `clamp(${MIN_TREE_SIZE}px, ${size}px, calc(100% - ${MIN_VIEWER_SIZE}px))`;
}

function pointerOf(event: PointerEvent, axis: SplitAxis): number {
  return axis === "row" ? event.clientX : event.clientY;
}

function measure(divider: HTMLElement, frame: FrameRef, axis: SplitAxis): Omit<Drag, "pointer"> {
  const container = mountedFrameOf(frame).getBoundingClientRect();
  const line = divider.getBoundingClientRect();
  return axis === "row"
    ? { size: line.left - container.left, containerSize: container.width }
    : { size: line.top - container.top, containerSize: container.height };
}

function mountedFrameOf(frame: FrameRef): HTMLDivElement {
  if (frame.current === null) throw new Error("The split view is not mounted.");
  return frame.current;
}
