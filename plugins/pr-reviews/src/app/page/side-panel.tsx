// The Summary tab's side panel: the PR's Reviewers, Checks and Labels, read only, in plain sections
// split by hairlines. A section with nothing in it is left out; with none, so is the panel.
import { useId, useLayoutEffect, useRef, type FocusEvent, type ReactNode, type RefObject } from "react";
import type { Label, PrDetail } from "../../contract.ts";
import { CheckList } from "./check-list.tsx";
import { ReviewerList } from "./reviewer-list.tsx";

export const hasSidePanel = (pr: PrDetail): boolean => pr.reviewers.length > 0 || pr.checks.length > 0 || pr.labels.length > 0;

// Sticky beside the description; below 600px of the Summary tab's container it drops away.
export function SidePanel({ pr, focus }: { pr: PrDetail; focus: SidePanelFocus }) {
  return (
    <aside {...focus.panel} aria-label="Pull request details" className="sticky top-6 grid grid-cols-[minmax(0,1fr)] @max-[600px]:hidden">
      {pr.reviewers.length > 0 && (
        <PanelSection title="Reviewers">
          <ReviewerList reviewers={pr.reviewers} />
        </PanelSection>
      )}
      {pr.checks.length > 0 && (
        <PanelSection title="Checks">
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

// A refresh can remove the control holding focus: a check moving into the collapsed passing list,
// the Checks section when no check is left, the whole panel when no section is. Focus then goes to
// the passing list's button, or to the Summary tab's panel when there is none, never to the page.
// Called by the panel's parent: it must outlive the panel to see it removed.
export function useSidePanelFocus(): SidePanelFocus {
  const tab = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // The control last focused in the panel. Focus moving to another element forgets it; focus lost
  // to nothing (the control removed, or the window left for a check's page) keeps it.
  const focused = useRef<Element | null>(null);
  // why an effect: only the committed page shows whether the refresh removed the focused control.
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

// Each section after the first leads with a hairline.
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="border-t border-border py-3.5 first:border-t-0 first:pt-0">
      <h2 id={headingId} className="mb-2 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function LabelChips({ labels }: { labels: Label[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <li key={label.name} className="inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-full px-2 text-xs text-foreground ring-1 ring-border ring-inset">
          <span aria-hidden className="size-[7px] shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
          <span className="truncate">{label.name}</span>
        </li>
      ))}
    </ul>
  );
}
