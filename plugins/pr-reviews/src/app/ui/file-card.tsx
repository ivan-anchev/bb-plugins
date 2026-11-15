// A file as bb's own Changes panel draws one, the one card the Changes tab and the guide share: a
// bordered card on the page's background, its header sticky at the top of what scrolls it, with
// the path in mono at the start and whatever the place adds at the end (the file's `+N -M`, a
// guide row's note and Show), then the file's diff.
//
// The header draws the card's edge where it sits, its top and sides over the card's own, so it
// keeps its rounded top once stuck. A band of the page's background above it (its shadow) hides
// what scrolls past its corners. The card is not clipped, which would cut the header's edge and
// stop the band: the body rounds its own bottom.
import type { ReactNode, Ref } from "react";

/** The card's surface, for a diff drawn in one without a header (the guide overview's hidden hunks). */
export const FILE_CARD = "rounded-lg border border-border bg-background";

type FileCardProps = {
  path: string;
  /** The header's end, after the path. */
  end?: ReactNode;
  /** The body, or null for a card that is only its header (a folded guide row). */
  children: ReactNode | null;
  /** The card as a focus target, not a tab stop: a jump to the file focuses it. */
  ref?: Ref<HTMLElement>;
};

// The scroll margins keep a jump's landing clear of the scroller's top edge, and anything in the
// card that scrolls into view, such as a focused button or a revealed thread, clear of the header.
export function FileCard({ path, end, children, ref }: FileCardProps) {
  return (
    <section
      ref={ref}
      tabIndex={ref === undefined ? undefined : -1}
      className={`${FILE_CARD} scroll-mt-4 outline-none focus-visible:ring-1 focus-visible:ring-ring [&_*]:scroll-mt-12`}
    >
      <Header path={path} end={end} />
      {children !== null && <div className="overflow-hidden rounded-b-lg">{children}</div>}
    </section>
  );
}

// A header with nothing under it draws the card's bottom edge too.
const HEADER =
  "sticky top-0 z-30 -mx-px -mt-px flex min-w-0 items-center gap-2 rounded-t-lg border-x border-t border-border bg-background py-1.5 pr-3 pl-2 text-xs font-medium text-foreground shadow-[0_-8px_0_0_var(--background)] last:-mb-px last:rounded-b-lg last:border-b";

function Header({ path, end }: { path: string; end: ReactNode }) {
  return (
    <div className={HEADER}>
      {/* Display only: `whitespace-pre` keeps the path's spaces as they are. */}
      <span title={path} className="min-w-0 shrink-[2] grow truncate pl-[1ch] font-mono leading-5 whitespace-pre">
        {path}
      </span>
      {end !== undefined && <span className="ml-auto flex min-w-0 items-center gap-2">{end}</span>}
    </div>
  );
}
