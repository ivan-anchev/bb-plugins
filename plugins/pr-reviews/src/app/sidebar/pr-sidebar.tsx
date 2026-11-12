// experimental_sidebar: the reader's PRs across every bb project with a GitHub remote, in three
// sections (Authored by me, Needs my review, Recently merged), stacks drawn as trees.
import { experimental_useRpcRefresh, useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { InboxPr } from "../../contract.ts";
import { useInbox, useVisits } from "../queries.ts";
import { PANEL_PATH, parseRoute, routeSubPath } from "../routes.ts";
import { Notice } from "../ui/notice.tsx";
import { ReadError } from "../ui/read-error.tsx";
import { visitsByPr } from "./attention.ts";
import { InboxSection } from "./inbox-section.tsx";

export function PrSidebar({ subPath }: PluginNavPanelProps) {
  const route = parseRoute(subPath);
  const inbox = useInbox();
  const visits = useVisits();
  const visited = visitsByPr(visits.data?.visits ?? []);
  const navigate = useBbNavigate();
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
          {inbox.data.sections.map((section) => (
            <InboxSection key={section.key} section={section} visits={visited} isOpen={isOpen} open={open} />
          ))}
        </div>
      )}
    </div>
  );
}
