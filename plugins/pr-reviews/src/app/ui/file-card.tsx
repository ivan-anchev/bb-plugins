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

const HEADER =
  "sticky top-0 z-30 -mx-px -mt-px flex min-w-0 items-center gap-2 rounded-t-lg border-x border-t border-border bg-background py-1.5 pr-3 pl-2 text-xs font-medium text-foreground shadow-[0_-8px_0_0_var(--background)] last:-mb-px last:rounded-b-lg last:border-b";

function Header({ path, end }: { path: string; end: ReactNode }) {
  return (
    <div className={HEADER}>
      <span title={path} className="min-w-0 shrink-[2] grow truncate pl-[1ch] font-mono leading-5 whitespace-pre">
        {path}
      </span>
      {end !== undefined && <span className="ml-auto flex min-w-0 items-center gap-2">{end}</span>}
    </div>
  );
}
