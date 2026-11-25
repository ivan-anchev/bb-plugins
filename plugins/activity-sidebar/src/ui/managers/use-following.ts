// A manager's avatar following the cursor while the pointer is over its own row or tile. The following
// itself is blob-avatar's own `gaze`; this only says when. Leaving, its gaze goes at once, so the eyes ease
// home on the library's spring, and it holds still again once they are home. A touch has no hover; with
// Reduce motion nothing follows.
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useReducedMotion } from "../motion/reduced-motion.ts";

/** Still; following the cursor; or easing home, moving but no longer following. */
export type Following = "off" | "on" | "easing-home";

// why: blob-avatar's look hands back to its idle over about 0.8s (its HAND_OUT spring); held still sooner, the eyes would snap home.
const EASE_HOME_MS = 900;

/** Spread `pointer` on the row's or tile's link; give `following` to its ManagerAvatar. */
export function useFollowing(): { following: Following; pointer: { onPointerEnter(e: PointerEvent): void; onPointerLeave(e: PointerEvent): void } } {
  const reduced = useReducedMotion();
  const [following, setFollowing] = useState<Following>("off");
  const home = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(home.current), []);

  return {
    following: reduced ? "off" : following,
    pointer: {
      onPointerEnter: (e) => {
        if (e.pointerType === "touch") return;
        clearTimeout(home.current);
        setFollowing("on");
      },
      onPointerLeave: (e) => {
        if (e.pointerType === "touch") return;
        setFollowing((was) => (was === "on" ? "easing-home" : was));
        clearTimeout(home.current);
        home.current = setTimeout(() => setFollowing("off"), EASE_HOME_MS);
      },
    },
  };
}
