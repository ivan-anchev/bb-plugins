// A lane's header: a bar on the theme's recessed surface (issue-board.css `.rmi-lane`) holding the
// lane's status glyph, its name, how many it holds and a chevron. The whole bar folds the lane, as
// Activity Sidebar's section title does (src/ui/shelf-title.tsx).
import type { ReactNode, Ref } from "react";

type LaneHeaderProps = { ref: Ref<HTMLButtonElement>; id: string; glyph: ReactNode; name: string; count: number; open: boolean; listId: string; onToggle(): void };

export function LaneHeader({ ref, id, glyph, name, count, open, listId, onToggle }: LaneHeaderProps) {
  return (
    <h2 id={id} className="rmi-lane-heading">
      <button ref={ref} type="button" className="rmi-lane" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={onToggle}>
        <span className="rmi-lane-glyph" aria-hidden>
          {glyph}
        </span>
        <span className="rmi-lane-name">{name}</span>
        <span className="rmi-count">{count}</span>
        <svg className="rmi-chevron" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </h2>
  );
}
