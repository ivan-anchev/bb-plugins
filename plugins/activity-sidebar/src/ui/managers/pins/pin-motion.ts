// How the Managers view moves as a manager is pinned or unpinned, as data: its avatar flies from its row
// to its tile (or back), growing or shrinking on the way, while its words fade in after it; everything
// else that moved slides to its new place; a newcomer fades in. Pure; use-pin-motion.ts plays it.

export type Box = { x: number; y: number; w: number; h: number };

/** An item where it stands, in the scroller's content: in the pinned grid or the list, its box and its avatar's. */
export type Placed = { where: "grid" | "list"; box: Box; face: Box };

/** From where it was seen to its place: `dx`, `dy` and `scale` are where it starts, relative to where it lands. */
export type PinMove =
  | { kind: "slide"; key: string; dx: number; dy: number }
  | { kind: "fly"; key: string; dx: number; dy: number; scale: number }
  | { kind: "arrive"; key: string };

/**
 * The moves from `before` to `after`, both by key. Nothing moves unless an item crossed between the grid
 * and the list: a manager started, archived or renamed changes the view as it always has, at once.
 */
export function planPinMotion(before: ReadonlyMap<string, Placed>, after: ReadonlyMap<string, Placed>): PinMove[] {
  const crossed = [...after].some(([key, now]) => {
    const was = before.get(key);
    return was !== undefined && was.where !== now.where;
  });
  if (!crossed) return [];
  return [...after].flatMap(([key, now]): PinMove[] => {
    const was = before.get(key);
    if (was === undefined) return [{ kind: "arrive", key }];
    if (was.where !== now.where) {
      return [{ kind: "fly", key, dx: was.face.x - now.face.x, dy: was.face.y - now.face.y, scale: was.face.w / now.face.w }];
    }
    const dx = was.box.x - now.box.x;
    const dy = was.box.y - now.box.y;
    return Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 ? [] : [{ kind: "slide", key, dx, dy }];
  });
}
