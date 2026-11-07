// A hover-and-focus tooltip whose trigger is the one focus stop (adapted from code-explorer's).
// REVIEW.md: Escape closes it wherever focus is, it stays open while the pointer is over the
// trigger or the popup, or while the trigger has focus, and the popup sits inside the hover area
// so there is no dead gap between them (WCAG 1.4.13).
import { useEffect, useId, useState, type ReactNode } from "react";

type TooltipProps = {
  content: ReactNode;
  /** Renders the trigger; pass `describedBy` to its `aria-describedby`. */
  children: (describedBy: string) => ReactNode;
};

export function Tooltip({ content, children }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const id = useId();
  useDismissOnEscape(open, setDismissed);
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        setDismissed(false);
      }}
      onBlur={() => setFocused(false)}
    >
      {children(id)}
      {/* pb-1.5 is the gap above the trigger, inside the popup, so the pointer never leaves the hover area. */}
      <span role="tooltip" id={id} hidden={!open} className="absolute bottom-full left-1/2 z-50 -translate-x-1/2 pb-1.5">
        <span className="block w-max max-w-[320px] rounded-md bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/8 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none">
          {content}
        </span>
      </span>
    </span>
  );
}

// why an effect: Escape must close the tooltip wherever focus is, which only a document listener
// sees. It claims the key (preventDefault) only while open, so Escape otherwise stays bb's.
function useDismissOnEscape(open: boolean, setDismissed: (dismissed: boolean) => void): void {
  useEffect(
    function dismissOnEscape() {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        setDismissed(true);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    },
    [open, setDismissed],
  );
}
