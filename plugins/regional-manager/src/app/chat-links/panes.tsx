// Every thread pane on screen, each known by a hidden marker in its header row, and the issue tabs
// waiting to open in a pane. bb's split layout shows one pane per thread, and an issue link in a
// message opens its issue in the pane of its regional manager's thread (open-on-click.ts): a link
// asks for the tab by that thread, and the marker of whichever pane shows the thread, now or once one
// does, opens it in its own side panel. why a marker per pane: the side panel a component can open a
// tab in is its own surface's, and the chat overlay, mounted once per window, has none.
import { experimental_useAppPanel, experimental_useRpcQuery, type ExperimentalThreadHeaderRowProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { IssueId } from "../../model/issue/issue.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { issueTabOf } from "../board/issue-tab/open-issue.ts";
import { useCoordinatorOfThread } from "../profile/use-manager.ts";

export const paneMarker = { id: "pane", component: PaneMarker };

/** Opens the issue's tab in the side panel of the pane showing `threadId`, a regional manager's: at once if one does, or as one comes to show it. A later ask for the thread replaces an earlier one. */
export function openIssueTabIn(threadId: string, issueId: IssueId): void {
  requested.set(threadId, issueId);
  for (const listener of listeners) listener();
}

/** The thread of the pane `element` is in: the pane whose marker shares the deepest ancestor with it; null when no pane holds it. */
export function threadOfPane(element: Element): string | null {
  let best: { depth: number; threadId: string } | null = null;
  for (const { marker, threadId } of panes) {
    const shared = sharedAncestor(marker, element);
    const depth = depthOf(shared);
    if (shared !== null && (best === null || depth > best.depth)) best = { depth, threadId };
  }
  return best?.threadId ?? null;
}

/** A pane's marker: a hidden element that takes no room, and the opener of the issue tab asked of its thread. */
function PaneMarker({ threadId }: ExperimentalThreadHeaderRowProps) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const pane = { threadId, marker: ref.current! };
    panes.add(pane);
    return () => void panes.delete(pane);
  }, [threadId]);
  const issueId = useSyncExternalStore(subscribe, () => requested.get(threadId) ?? null);
  return (
    <span ref={ref} hidden>
      {issueId !== null && <TabOpener threadId={threadId} issueId={issueId} />}
    </span>
  );
}

// ------------------------------------------------------------------ layer 2

type Pane = { threadId: string; marker: HTMLElement };

const panes = new Set<Pane>();
/** The issue whose tab each regional manager's thread is asked to open, until a pane showing it does. */
const requested = new Map<string, IssueId>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Opens the issue asked of the pane's thread once the thread reads as a regional manager's, whose tabs bb shows. */
function TabOpener({ threadId, issueId }: { threadId: string; issueId: IssueId }) {
  const { coordinator } = useCoordinatorOfThread(threadId);
  return coordinator === null ? null : <BoardTabOpener threadId={threadId} coordinatorId={coordinator.id} issueId={issueId} />;
}

/** Opens the issue's tab, titled from its board row, as the Board does; an issue its board has none of is let go. */
function BoardTabOpener({ threadId, coordinatorId, issueId }: { threadId: string; coordinatorId: CoordinatorId; issueId: IssueId }) {
  const panel = experimental_useAppPanel();
  const issues = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } }).data?.issues;
  useEffect(() => {
    if (issues === undefined) return;
    const issue = issues.find(({ id }) => id === issueId);
    // why kept on a decline: bb declines a tab it hides, as it does in a thread before it reads it as a manager's; a new read of the board or a new panel asks again.
    if (issue !== undefined && !panel.openTab(issueTabOf(issue))) return;
    if (requested.get(threadId) !== issueId) return;
    requested.delete(threadId);
    for (const listener of listeners) listener();
  }, [issues, issueId, panel, threadId]);
  return null;
}

/** The deepest element holding both; null when they share none, as when one is out of the document. */
function sharedAncestor(a: Element, b: Element): Element | null {
  let shared: Element | null = a;
  while (shared !== null && !shared.contains(b)) shared = shared.parentElement;
  return shared;
}

function depthOf(element: Element | null): number {
  let depth = 0;
  for (let at = element; at !== null; at = at.parentElement) depth++;
  return depth;
}
