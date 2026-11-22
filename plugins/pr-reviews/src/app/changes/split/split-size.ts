export type SplitAxis = "row" | "column";

export type TreeSizes = Record<SplitAxis, number>;

export const DEFAULT_TREE_SIZES: TreeSizes = { row: 288, column: 320 };

export const MIN_TREE_SIZE = 120;

export const MIN_VIEWER_SIZE = 160;

const KEYBOARD_STEP = 16;

const KEYS_BY_AXIS: Record<SplitAxis, { shrink: string; grow: string }> = {
  row: { shrink: "ArrowLeft", grow: "ArrowRight" },
  column: { shrink: "ArrowUp", grow: "ArrowDown" },
};

export type TreeSizeRange = { min: number; max: number; now: number };

export function clampedTreeSize(size: number, containerSize: number): number {
  return Math.min(Math.max(Math.round(size), MIN_TREE_SIZE), maxTreeSizeOf(containerSize));
}

export function treeSizeRangeOf(size: number, containerSize: number): TreeSizeRange {
  return { min: MIN_TREE_SIZE, max: maxTreeSizeOf(containerSize), now: clampedTreeSize(size, containerSize) };
}

export function treeSizeAfterKey(key: string, axis: SplitAxis, size: number, containerSize: number): number | null {
  const keys = KEYS_BY_AXIS[axis];
  switch (key) {
    case keys.shrink:
      return clampedTreeSize(size - KEYBOARD_STEP, containerSize);
    case keys.grow:
      return clampedTreeSize(size + KEYBOARD_STEP, containerSize);
    case "Home":
      return clampedTreeSize(0, containerSize);
    case "End":
      return clampedTreeSize(containerSize, containerSize);
    default:
      return null;
  }
}

function maxTreeSizeOf(containerSize: number): number {
  return Math.max(MIN_TREE_SIZE, Math.floor(containerSize - MIN_VIEWER_SIZE));
}
