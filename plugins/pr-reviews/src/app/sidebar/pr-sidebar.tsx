// experimental_sidebar: the reader's PRs across every bb project with a GitHub remote, in three
// sections (Authored by me, Needs my review, Recently merged), stacks drawn as trees, under a
// controls bar whose Filter hides the sections the reader does not watch.
import { useRef } from "react";
import { experimental_useRpcRefresh, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { InboxPr } from "../../contract.ts";
import { useInbox, useVisits } from "../queries.ts";
import { PANEL_PATH, parseRoute, routeSubPath } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { visitsByPr } from "./attention.ts";
import { InboxSection } from "./inbox-section.tsx";
import { useHiddenSections } from "./section-filter.ts";
import { SidebarControls } from "./sidebar-controls.tsx";

export function PrSidebar({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  const inbox = useInbox();
  const visits = useVisits();
  const visited = visitsByPr(visits.data?.visits ?? []);
  const navigate = useBbNavigate();
  const [hiddenSections, setHiddenSections] = useHiddenSections();
  const shownSections = inbox.data?.sections.filter((section) => !hiddenSections.includes(section.key)) ?? [];
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
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className="shrink-0 px-1.5">
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
        // bb's sidebar scrolls; the section headings stick to it.
        <div className="px-1.5 pb-3">
          <SidebarControls sections={inbox.data.sections} hidden={hiddenSections} onChange={setHiddenSections} filterButton={filterButton} />
          {shownSections.length === 0 ? (
            <AllSectionsHidden onShowAll={showAll} />
          ) : (
            shownSections.map((section) => <InboxSection key={section.key} section={section} visits={visited} isOpen={isOpen} open={open} />)
          )}
        </div>
      )}
    </div>
  );
}

function AllSectionsHidden({ onShowAll }: { onShowAll(): void }) {
  return (
    <p className="px-2.5 py-2 text-xs leading-4 text-subtle-foreground">
      All sections are hidden.{" "}
      <button
        type="button"
        onClick={onShowAll}
        className="cursor-pointer rounded-sm font-medium text-foreground decoration-foreground/35 underline-offset-[3px] hover:underline focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        Show all
      </button>
    </p>
  );
}
