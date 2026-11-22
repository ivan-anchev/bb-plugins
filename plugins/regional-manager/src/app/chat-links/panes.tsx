// The issue tabs waiting to open in a regional manager's thread, and the row under each thread pane's
// header that opens them and marks which thread the pane shows. An issue link in a message opens its issue in the pane of its manager's
// thread (open-on-click.ts): it asks for the tab by that thread, and the row of whichever pane shows
// the thread, now or once one does, opens it in its own side panel. why a row per pane: the side
// panel a component can open a tab in is its own surface's, and the chat overlay, mounted once per
// window, has none.
import { experimental_useAppPanel, useBbContext, type ExperimentalOpenTabOptions, type ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useSyncExternalStore } from "react";
import type { IssueRow } from "../../contract.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { issueTabOf } from "../board/issue-tab/open-issue.ts";
import { useBoardIssue } from "../board/use-board-issue.ts";
import { useCoordinatorOfThread } from "../profile/use-manager.ts";

export const paneMarker = { id: "pane", component: PaneMarker };

/** Opens the issue's tab in the side panel of the pane showing `threadId`, a regional manager's: at once if one does, or as one comes to show it. A later ask for the thread replaces an earlier one. */
export function openIssueTabIn(threadId: string, issueId: IssueId): void {
  requested.set(threadId, issueId);
  notify();
}

/** The thread of the pane `element` is in: the one pane marker in the nearest of its ancestors that holds any; null when none does, or that ancestor holds several. */
export function threadOfPane(element: Element): string | null {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const markers = at.querySelectorAll<HTMLElement>(`[${PANE_ATTRIBUTE}]`);
    if (markers.length > 0) return markers.length === 1 ? (markers[0]?.getAttribute(PANE_ATTRIBUTE) ?? null) : null;
  }
  return null;
}

/** A pane's row under its header, hidden: its marker, naming its thread, and the opener of the issue tab asked of that thread, while one is. */
function PaneMarker({ threadId }: ExperimentalThreadHeaderRowProps) {
  const issueId = useSyncExternalStore(subscribe, () => requested.get(threadId) ?? null);
  return (
    <span hidden data-rmi-pane={threadId}>
      {issueId !== null && <TabOpener threadId={threadId} issueId={issueId} />}
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

/** The marker of a pane (PaneMarker): its thread's id. */
const PANE_ATTRIBUTE = "data-rmi-pane";

/** The issue whose tab each regional manager's thread is asked to open, until a pane showing it does. */
const requested = new Map<string, IssueId>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Opens the issue asked of the pane's thread once the thread reads as a regional manager's, whose tabs bb shows. */
function TabOpener({ threadId, issueId }: { threadId: string; issueId: IssueId }) {
  const { coordinator } = useCoordinatorOfThread(threadId);
  return coordinator === null ? null : <BoardTabOpener threadId={threadId} coordinatorId={coordinator.id} issueId={issueId} />;
}

/**
 * Opens the issue's tab, titled from its board row, as the Board does; an issue its board has none
 * of is let go. While the board can't be read, it opens by the issue's id, where the tab shows the
 * failure and Retry. bb declines the open while the pane isn't the one the app has focused, as a split
 * it just added isn't yet as it mounts (measured live, bb 0.50.1), so the open is asked again as the
 * focused thread changes, and as the board reads again.
 */
function BoardTabOpener({ threadId, coordinatorId, issueId }: { threadId: string; coordinatorId: CoordinatorId; issueId: IssueId }) {
  const panel = experimental_useAppPanel();
  const focused = useBbContext().threadId;
  const { read, issues, issue } = useBoardIssue(coordinatorId, issueId);
  const failed = issues === undefined && read.error !== null;
  useEffect(() => {
    if (issues === undefined && !failed) return;
    const opening = openingOf(issueId, issue, failed);
    if (opening !== null && !panel.openTab(opening)) return;
    if (requested.get(threadId) !== issueId) return;
    requested.delete(threadId);
    notify();
  }, [issues, issue, failed, issueId, panel, threadId, focused]);
  return null;
}

/** What opens the issue's tab: titled from its board row; by its id alone while the board can't be read; nothing for an issue its board has none of. */
function openingOf(issueId: IssueId, issue: IssueRow | undefined, failed: boolean): ExperimentalOpenTabOptions | null {
  if (issue !== undefined) return issueTabOf(issueId, issue.title);
  return failed ? issueTabOf(issueId, null) : null;
}
