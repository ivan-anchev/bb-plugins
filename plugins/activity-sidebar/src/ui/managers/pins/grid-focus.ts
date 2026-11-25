// Where the arrow keys take focus in the Managers view: the pinned grid's tiles, then the list's rows,
// all in one order. ←/→ move along the grid; ↑/↓ move a grid row at a time, then on into the list, and
// from the list's first row ↑ goes back to the grid's last row. Pure.

export type ArrowKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

/** The view's items: `tiles` tiles in `columns` columns, then rows, `total` in all. */
type ManagerGrid = { tiles: number; columns: number; total: number };

/** The item focus moves to from `at` (null: from the list itself, onto the first item); null where the key doesn't move it. */
export function nextItem(at: number | null, key: ArrowKey, { tiles, columns, total }: ManagerGrid): number | null {
  if (total === 0) return null;
  if (at === null) return 0;
  const inGrid = at < tiles;
  switch (key) {
    case "ArrowLeft":
      return inGrid ? Math.max(at - 1, 0) : null;
    case "ArrowRight":
      return inGrid ? Math.min(at + 1, tiles - 1) : null;
    case "ArrowDown":
      if (!inGrid) return Math.min(at + 1, total - 1);
      if (at + columns < tiles) return at + columns;
      // why: from above a short last row, down lands on that row's last tile; from the last row, on the list's first row.
      return rowOf(at, columns) === rowOf(tiles - 1, columns) ? Math.min(tiles, total - 1) : tiles - 1;
    case "ArrowUp":
      if (inGrid) return at >= columns ? at - columns : at;
      if (at === tiles && tiles > 0) return rowOf(tiles - 1, columns) * columns;
      return Math.max(at - 1, 0);
    default:
      key satisfies never;
      return null;
  }
}

export function isArrowKey(key: string): key is ArrowKey {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

function rowOf(at: number, columns: number): number {
  return Math.floor(at / columns);
}
