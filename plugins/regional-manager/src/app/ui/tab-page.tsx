// The page a regional manager's side-panel tab draws in (the Board, an issue's tab): the element that
// scrolls, its column centred in a wide panel.
import type { ReactNode } from "react";

export function TabPage({ children }: { children: ReactNode }) {
  return (
    // why the tab stop: the page scrolls, and the keyboard scrolls only what has focus (REVIEW.md).
    <div tabIndex={0} className="h-full min-h-0 overflow-y-auto bg-background text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4">{children}</div>
    </div>
  );
}
