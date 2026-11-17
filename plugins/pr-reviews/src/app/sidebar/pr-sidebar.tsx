// The panel's PR list across every bb project with a GitHub remote, in three sections (Authored by
// me, Needs my review, Recently merged), stacks drawn as trees. A pane header above the list holds
// the section chips, which list one section for the session, and the Filter that hides the sections
// the reader does not watch; each section's heading folds it.
import { useRef } from "react";
import { experimental_useRpcRefresh, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { InboxPr, SectionKey } from "../../contract.ts";
import { useInbox, useVisits } from "../queries.ts";
import { PANEL_PATH, parseRoute, routeSubPath } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { useRememberedState } from "../use-remembered-state.ts";
import { visitsByPr } from "./attention.ts";
import { InboxSection } from "./inbox-section.tsx";
import { SectionChips } from "./section-chips.tsx";
import { COLLAPSED_SECTIONS, HIDDEN_SECTIONS, useSectionSet, withSection } from "./section-filter.ts";
import { SidebarHeader } from "./sidebar-controls.tsx";

// The chip's section outlives the sidebar for the session: bb remounts the panel when the window
// crosses a layout breakpoint, and that should not drop it.
const rememberedOnly = new Map<string, SectionKey | null>();

export function PrSidebar({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  const inbox = useInbox();
  const visits = useVisits();
  const visited = visitsByPr(visits.data?.visits ?? []);
  const navigate = useBbNavigate();
  const sections = inbox.data?.sections ?? [];
  const [hiddenSections, setHiddenSections] = useSectionSet(HIDDEN_SECTIONS);
  const [foldedSections, setFoldedSections] = useSectionSet(COLLAPSED_SECTIONS);
  const [only, setOnly] = useRememberedState(rememberedOnly, "sidebar", null);
  const shownSections = sections.filter((section) => !hiddenSections.includes(section.key));
  const listedSections = only === null ? shownSections : shownSections.filter((section) => section.key === only);
  // Chips offer only shown sections, so hiding the chip's section goes back to All rather than
  // leaving a pressed chip for a section that is gone.
  const hide = (hidden: SectionKey[]) => {
    setHiddenSections(hidden);
    if (only !== null && hidden.includes(only)) setOnly(null);
  };
  // "Show all" leaves as the sections return, so it hands focus to the Filter button, which stays,
  // never to the page (REVIEW.md).
  const filterButton = useRef<HTMLButtonElement>(null);
  const showAll = () => {
    filterButton.current?.focus();
    setHiddenSections([]);
  };
  // Clicking the open PR again re-reads, as Refresh does, so a failed read is retried
  // (REVIEW.md); navigating to the route already shown would not.
  const { refresh } = experimental_useRpcRefresh();
  const isOpen = (pr: InboxPr) => route.kind === "pr" && route.projectId === pr.projectId && route.number === pr.number;
  const open = (pr: InboxPr) =>
    isOpen(pr) ? refresh() : navigate.toPluginPanel(PANEL_PATH, { subPath: routeSubPath({ kind: "pr", projectId: pr.projectId, number: pr.number }) });

  return (
    <div className="pr-reviews-sidebar flex h-full min-h-0 flex-col text-foreground">
      <SidebarHeader sections={sections} hidden={hiddenSections} onHiddenChange={hide} filterButton={filterButton}>
        <SectionChips sections={shownSections} only={only} onOnlyChange={setOnly} />
      </SidebarHeader>
      {/* The list scrolls under the header; padding belongs on the content, so sticky headings reach the scrollport's top. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-1.5">
          <ReadError read={inbox} what="pull requests" />
          <ReadError read={visits} what="which pull requests you opened" />
          {inbox.data?.unreadable.map(({ id, name, message }) => (
            <Notice key={id} tone="error">
              Could not read the git remote of {name}: {message}
            </Notice>
          ))}
          {inbox.isLoading && <Notice>Loading pull requests…</Notice>}
        </div>
        {inbox.data !== undefined && (
          <div className="px-1.5 pt-2 pb-3">
            {shownSections.length === 0 ? (
              <QuietLine text="All sections are hidden" action="Show all" onAction={showAll} />
            ) : (
              listedSections.map((section) => (
                <InboxSection
                  key={section.key}
                  section={section}
                  visits={visited}
                  isOpen={isOpen}
                  open={open}
                  folded={foldedSections.includes(section.key)}
                  onFold={(folded) => setFoldedSections(withSection(foldedSections, section.key, folded))}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Activity's notice: one quiet line in the section titles' type, its action a brighter word.
function QuietLine({ text, action, onAction }: { text: string; action: string; onAction(): void }) {
  return (
    <p className="flex h-6 items-center gap-1 px-2.5 text-[11px] leading-3.5 font-medium text-subtle-foreground">
      {text}
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onAction}
        className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        {action}
      </button>
    </p>
  );
}
