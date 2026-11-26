// A control's name shown under it on hover and keyboard focus, in the theme's tooltip (ported from
// pr-reviews' ui/tooltip.tsx: a plugin imports nothing from another). It stays open while the pointer
// is on the control or the bubble, which sits inside the hover area so there is no dead gap between
// them, or while the control has keyboard focus, each on its own (WCAG 1.4.13). Under the pointer it
// waits OPEN_DELAY, but shows at once while another has just closed; on keyboard focus, at once.
// Escape closes it wherever focus is, and pressing the control closes it until the pointer or the
// keyboard comes back. why aria-hidden: the control's own aria-label already names it.
import { useEffect, useRef, useState, type ReactNode } from "react";

const OPEN_DELAY = 500;
/** How long after one closes the next shows at once, as the pointer runs along a row of controls. */
const WARM = 400;
// why module-wide: the warmth passes from one control's tooltip to the next.
let warmUntil = 0;

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useDismissOnEscape(open, setDismissed);

  // why here, not in an effect once closed: the pointer leaving one control enters the next in the same event.
  const warmIfClosing = (stillOpen: boolean) => {
    if (open && !stillOpen) warmUntil = performance.now() + WARM;
  };

  return (
    <span
      className="as-tip-area"
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        clearTimeout(timer.current);
        setDismissed(false);
        if (performance.now() < warmUntil) setHovered(true);
        else timer.current = setTimeout(() => setHovered(true), OPEN_DELAY);
      }}
      onPointerLeave={() => {
        clearTimeout(timer.current);
        warmIfClosing(focused);
        setHovered(false);
      }}
      onPointerDown={() => {
        clearTimeout(timer.current);
        warmIfClosing(false);
        setDismissed(true);
      }}
      // why: a click focuses the control too; only keyboard focus (:focus-visible) names it.
      onFocus={(e) => {
        if (!e.target.matches(":focus-visible")) return;
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => {
        warmIfClosing(hovered);
        setFocused(false);
      }}
    >
      {children}
      <span className="as-tip-place" hidden={!open}>
        <span className="as-tip" role="tooltip" aria-hidden>
          {label}
        </span>
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

/** While open, Escape closes it wherever focus is, which only a document listener sees; the key stays bb's otherwise. */
function useDismissOnEscape(open: boolean, setDismissed: (dismissed: boolean) => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setDismissed]);
}
