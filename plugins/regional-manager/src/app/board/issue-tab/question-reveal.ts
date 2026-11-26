// A request, from an issue's row under Needs you on the Board, that the issue's tab show the
// question it waits on. why apart from the tab's params: bb keys a tab by them, so they name the
// issue alone and one issue keeps one tab, whatever opened it. The request waits here, in the app's
// memory, which the Board and every tab share, until that issue's feed draws the question and takes
// it, or reads that none waits.
import { useCallback, useSyncExternalStore } from "react";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../model/role.ts";

type Request = { coordinatorId: CoordinatorId; issueId: IssueId };

/** The request waiting, null for none. why one: the row pressed last is the question the user went to. */
let waiting: Request | null = null;
const listeners = new Set<() => void>();

/** Asks the issue's tab to show the question it waits on, as it opens or, open already, now. */
export const revealQuestionOf = (coordinatorId: CoordinatorId, issueId: IssueId): void => setWaiting({ coordinatorId, issueId });

/**
 * Whether the issue's tab is asked to show its waiting question, and how its feed takes the request
 * once it showed one, or read that none waits.
 */
export function useQuestionReveal(coordinatorId: CoordinatorId, issueId: IssueId): { asked: boolean; taken: () => void } {
  const request = useSyncExternalStore(subscribe, () => waiting);
  const asked = request !== null && request.coordinatorId === coordinatorId && request.issueId === issueId;
  // why only the request read: a row pressed since asks for its own reveal, still to come.
  const taken = useCallback(() => {
    if (waiting === request) setWaiting(null);
  }, [request]);
  return { asked, taken };
}

function setWaiting(next: Request | null): void {
  waiting = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
