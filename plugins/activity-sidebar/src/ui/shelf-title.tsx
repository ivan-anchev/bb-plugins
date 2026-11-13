// The words between the rows: a section's title, which folds it; Archived's "Show more"; a notice.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import type { ListItem } from "../list/items.ts";

type TitleItem = Extract<ListItem, { kind: "title" }>;

/**
 * Quiet small words that fold their section, with no caret; folded, how many it holds at the end.
 * `action` sits after them, outside the fold button (Activity's project filter).
 */
export function SectionTitle({ item, onToggle, action }: { item: TitleItem; onToggle(): void; action: ReactNode }) {
  // why: tabIndex -1: the scroller is the list's one tab stop and ↑/↓ move between its items.
  return (
    <div className="as-section-title">
      <h2 className="as-heading">
        <button type="button" className="as-fold" tabIndex={-1} aria-expanded={item.open} onClick={onToggle}>
          <span className="as-fold-name">{item.label}</span>
          {item.count !== null && <span className="as-count">{item.count}</span>}
        </button>
      </h2>
      {action}
    </div>
  );
}

/** Archived's next rows: "Show 25 more", or "Show more" when only the server knows how many. */
export function MoreRow({ n, onPress }: { n: number | null; onPress(): void }) {
  return (
    <button type="button" className="as-row as-more" tabIndex={-1} onClick={onPress}>
      <span className="as-slot">
        <Icon name="ChevronDown" className="as-more-icon" aria-hidden />
      </span>
      <span className="as-title">{n === null ? "Show more" : `Show ${n} more`}</span>
    </button>
  );
}

/** One line in place of rows that are loading or failed; a failed page offers Retry. */
export function Notice({ text, onRetry }: { text: string; onRetry: (() => void) | null }) {
  return (
    <div className="as-notice" role="status">
      {text}
      {onRetry !== null && (
        <>
          <span aria-hidden>·</span>
          <button type="button" className="as-retry" tabIndex={-1} onClick={onRetry}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
