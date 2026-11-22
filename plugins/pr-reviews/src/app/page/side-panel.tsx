import { useId, useLayoutEffect, useRef, type FocusEvent, type ReactNode, type RefObject } from "react";
import type { PrDetail } from "../../contract.ts";
import type { Label } from "../../github/label.ts";
import { CheckList, ChecksStatus } from "./check-list.tsx";
import { ReviewerList } from "./reviewer-list.tsx";

export const hasSidePanel = (pr: PrDetail): boolean => pr.reviewers.length > 0 || pr.checks.length > 0 || pr.labels.length > 0;

export function SidePanel({ pr, focus }: { pr: PrDetail; focus: SidePanelFocus }) {
  return (
    <aside {...focus.panel} aria-label="Pull request details" className="sticky top-6 grid grid-cols-[minmax(0,1fr)] @max-[600px]:hidden">
      {pr.reviewers.length > 0 && (
        <PanelSection title="Reviewers">
          <ReviewerList reviewers={pr.reviewers} />
        </PanelSection>
      )}
      {pr.checks.length > 0 && (
        <PanelSection title="Checks" status={<ChecksStatus checks={pr.checks} />}>
          <CheckList checks={pr.checks} toggle={focus.toggle} />
        </PanelSection>
      )}
      {pr.labels.length > 0 && (
        <PanelSection title="Labels">
          <LabelChips labels={pr.labels} />
        </PanelSection>
      )}
    </aside>
  );
}

/** What `useSidePanelFocus` hands out: `tab` for the element holding the panel, the rest for the panel. */
export type SidePanelFocus = {
  tab: RefObject<HTMLDivElement | null>;
  panel: { onFocus(event: FocusEvent): void; onBlur(event: FocusEvent): void };
  toggle: RefObject<HTMLButtonElement | null>;
};

export function useSidePanelFocus(): SidePanelFocus {
  const tab = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const focused = useRef<Element | null>(null);
  useLayoutEffect(function refocusWhenTheFocusedControlWasRemoved() {
    const control = focused.current;
    if (control === null || control.isConnected || document.activeElement !== document.body) return;
    focused.current = null;
    (toggle.current ?? tab.current?.closest<HTMLElement>('[role="tabpanel"]'))?.focus();
  });
  return {
    tab,
    panel: {
      onFocus: (event) => {
        focused.current = event.target;
      },
      onBlur: (event) => {
        if (event.relatedTarget !== null) focused.current = null;
      },
    },
    toggle,
  };
}

function PanelSection({ title, status, children }: { title: string; status?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border-t border-border py-3.5 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id={headingId} className="text-xs font-medium text-muted-foreground">
          {title}
        </h2>
        {status}
      </div>
      {children}
    </section>
  );
}

function LabelChips({ labels }: { labels: Label[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li key={label.name} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-xs text-foreground ring-1 ring-border ring-inset">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
          <span className="truncate">{label.name}</span>
        </li>
      ))}
    </ul>
  );
}
