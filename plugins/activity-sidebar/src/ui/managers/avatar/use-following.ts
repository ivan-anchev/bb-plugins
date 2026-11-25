// Which manager's avatar follows the cursor in the Managers view: the one whose row or tile has the
// pointer, and only that one. The following itself is blob-avatar's own `gaze`; this only says when.
// Leaving, its gaze goes at once, so the eyes ease home on the library's spring, and it holds still
// again once they are home; another manager hovered meanwhile takes over at once, and the one easing
// home holds still then. A touch has no hover; with Reduce motion nothing follows.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useReducedMotion } from "../../motion/reduced-motion.ts";

/** Still; following the cursor; or easing home, moving but no longer following. */
export type Following = "off" | "on" | "easing-home";

/** An item's part: `following` for its ManagerAvatar, `pointer` spread on its link. */
export type Follow = { following: Following; pointer: { onPointerEnter(e: PointerKind): void; onPointerLeave(e: PointerKind): void } };

/** All a pointer event tells the follower: mouse, pen or touch. */
type PointerKind = Pick<PointerEvent, "pointerType">;

// why: blob-avatar's look hands back to its idle over about 0.8s (its HAND_OUT spring); held still sooner, the eyes would snap home.
const EASE_HOME_MS = 900;

/** The one avatar moving, by its item's key, and how. */
type Moving = { key: string; following: "on" | "easing-home" } | null;

/** One owner for the view: each item asks it for its own part by its key. */
export function useFollowing(): (key: string) => Follow {
  const reduced = useReducedMotion();
  const [moving, setMoving] = useState<Moving>(null);
  const home = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(home.current), []);

  return (key) => ({
    following: reduced || moving?.key !== key ? "off" : moving.following,
    pointer: {
      onPointerEnter: (e) => {
        if (e.pointerType === "touch") return;
        clearTimeout(home.current);
        setMoving({ key, following: "on" });
      },
      onPointerLeave: (e) => {
        if (e.pointerType === "touch") return;
        const easing = (was: Moving): Moving => (was?.key === key ? { key, following: "easing-home" } : was);
        setMoving(easing);
        clearTimeout(home.current);
        home.current = setTimeout(() => setMoving((was) => (was?.key === key && was.following === "easing-home" ? null : was)), EASE_HOME_MS);
      },
    },
  });
}
