import { useEffect, useId, useState, type ReactNode } from "react";

type TooltipProps = { content: ReactNode; className: string; children: ReactNode };

export function Tooltip({ content, className, children }: TooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const id = useId();
  useDismissOnEscape(open, setDismissed);
  return (
    <span
      className={`relative ${className}`}
      onPointerEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onPointerLeave={() => setHovered(false)}
    >
      <span
        tabIndex={0}
        aria-describedby={id}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
        className="block truncate rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {children}
      </span>
      <span role="tooltip" id={id} hidden={!open} className="absolute left-0 top-full z-50 pt-1.5">
        <span className="block rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95">
          {content}
        </span>
      </span>
    </span>
  );
}

function useDismissOnEscape(open: boolean, setDismissed: (dismissed: boolean) => void): void {
  useEffect(
    function dismissOnEscape() {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setDismissed(true);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    },
    [open, setDismissed],
  );
}
