// A control's name shown under it on hover and keyboard focus, in the theme's tooltip (ported from
// pr-reviews' ui/tooltip.tsx: a plugin imports nothing from another). It waits OPEN_DELAY under the
// pointer, but shows at once on keyboard focus, or while another has just closed. Escape closes it
// wherever focus is; it stays while the pointer is on the control or the bubble, which sits inside the
// hover area, so there is no dead gap between them (WCAG 1.4.13). Pressing the control closes it until
// the pointer comes back. why aria-hidden: the control's own aria-label already names it.
import { useEffect, useRef, useState, type ReactNode } from "react";

const OPEN_DELAY = 500;
/** How long after one closes the next shows at once, as the pointer runs along a row of controls. */
const WARM = 400;
// why module-wide: the warmth passes from one control's tooltip to the next.
let warmUntil = 0;

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dismissed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useCloseOnEscape(open, setOpen);

  const show = (now: boolean) => {
    clearTimeout(timer.current);
    if (now || performance.now() < warmUntil) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const close = () => {
    clearTimeout(timer.current);
    // why here, not in an effect once closed: the pointer leaving one control enters the next in the same event.
    if (open) warmUntil = performance.now() + WARM;
    setOpen(false);
  };

  return (
    <span
      className="as-tip-area"
      onPointerEnter={(e) => {
        if (e.pointerType !== "touch" && !dismissed.current) show(false);
      }}
      onPointerLeave={() => {
        dismissed.current = false;
        close();
      }}
      onPointerDown={() => {
        dismissed.current = true;
        close();
      }}
      // why: a click focuses the control too; only keyboard focus (:focus-visible) names it.
      onFocus={(e) => {
        if (e.target.matches(":focus-visible") && !dismissed.current) show(true);
      }}
      onBlur={close}
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
function useCloseOnEscape(open: boolean, setOpen: (open: boolean) => void): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);
}
