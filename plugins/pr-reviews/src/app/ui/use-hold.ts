// Press and hold to confirm, by pointer or by Enter or Space: for an action with no dialog before it.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export const HOLD_MS = 700;
// How long a press let go too early keeps asking to hold.
const NUDGE_MS = 1200;

/**
 * `onHeld` runs once a press lasts HOLD_MS. `holding` is true while the press lasts; `nudged`, for a
 * moment after a press let go too early. Spread `handlers` on the control.
 */
export function useHold(onHeld: () => void) {
  const [holding, setHolding] = useState(false);
  const [nudged, setNudged] = useState(false);
  const held = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nudge = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(held.current);
      clearTimeout(nudge.current);
    },
    [],
  );

  const press = () => {
    clearTimeout(nudge.current);
    setNudged(false);
    setHolding(true);
    held.current = setTimeout(() => {
      setHolding(false);
      onHeld();
    }, HOLD_MS);
  };
  const letGo = () => {
    if (!holding) return;
    clearTimeout(held.current);
    setHolding(false);
    setNudged(true);
    nudge.current = setTimeout(() => setNudged(false), NUDGE_MS);
  };

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (event.button === 0) press();
    },
    onPointerUp: letGo,
    onPointerLeave: letGo,
    onPointerCancel: letGo,
    // why preventDefault: a menu item selects itself on Enter or Space unless the keydown's default
    // is prevented; the hold, not the keydown, is the choice. A held key repeats its keydown.
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (!event.repeat) press();
    },
    onKeyUp: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") letGo();
    },
    onBlur: letGo,
  };
  return { holding, nudged, handlers };
}
