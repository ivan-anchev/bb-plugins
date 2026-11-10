// A hover-and-focus tooltip whose trigger is the one focus stop (adapted from code-explorer's).
// REVIEW.md: Escape closes it wherever focus is, it stays open while the pointer is over the
// trigger or the popup, or while the trigger has focus, and the popup sits inside the hover area
// so there is no dead gap between them (WCAG 1.4.13).
import { useEffect, useId, useState, type ReactNode } from "react";

type Placement = "top" | "top-end" | "bottom-start" | "bottom-end";

type TooltipProps = {
  content: ReactNode;
  /** "bottom-end" for a trigger at the right end of a header bar, where "top" would be clipped by
   *  the page's top edge and a centered popup by its right edge; "bottom-start" at its left end.
   *  "top-end" for a trigger at the right end of a row with room above, such as a box's footer. */
  placement?: Placement;
  /** Layout classes for the hover area, which is the trigger's box in its parent: "min-w-0" lets a
   *  truncating trigger shrink in a flex row. */
  className?: string;
  /** Renders the trigger; pass `describedBy` to its `aria-describedby`. */
  children: (describedBy: string) => ReactNode;
};

// The gap between trigger and popup is padding inside the popup, so the pointer never leaves the hover area.
const PLACEMENTS = {
  top: "bottom-full left-1/2 -translate-x-1/2 pb-1.5",
  "top-end": "bottom-full right-0 pb-1.5",
  "bottom-start": "top-full left-0 pt-1.5",
  "bottom-end": "top-full right-0 pt-1.5",
} as const satisfies Record<Placement, string>;

export function Tooltip({ content, placement = "top", className = "", children }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const id = useId();
  useDismissOnEscape(open, setDismissed);
  return (
    <span
      className={`relative inline-flex ${className}`}
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
      <span role="tooltip" id={id} hidden={!open} className={`absolute z-50 ${PLACEMENTS[placement]}`}>
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
