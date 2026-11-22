// Where an issue link lands when the chat overlay didn't catch it, as when bb followed it from a
// client that runs no overlay, or a pasted address: the panel's page at the link's route opens the
// regional manager's thread with the issue's tab open beside the Board (panes.tsx), or says why it
// can't. why the issue is checked here: a link outlives its issue's manager, which a user can delete.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { PANEL_PATH, type IssueLink } from "../../model/issue/link/issue-link.ts";
import { useManagerRead } from "../profile/use-manager.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { openIssueTabIn } from "./panes.tsx";

type IssueLandingProps = { ref: Ref<HTMLDivElement>; link: IssueLink; onBack(): void };

export function IssueLanding({ ref, link, onBack }: IssueLandingProps) {
  const { read, manager } = useManagerRead(link.coordinatorId);
  const threadId = manager?.kind === "started" ? manager.threadId : null;
  useOpenOnce(threadId, link);
  return (
    // why the tab stop: the page is text the keyboard reaches (REVIEW.md).
    <div ref={ref} tabIndex={0} className="flex h-full flex-col gap-3 bg-background px-6 py-6 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not open {link.issueId}: {read.error.message}</ReadFailure>}
      {read.data === undefined && read.error === null && <Note>Opening {link.issueId}…</Note>}
      {read.data !== undefined && manager?.kind !== "started" && (
        <Note>
          {manager === null ? `${link.issueId}'s regional manager was deleted.` : `${link.issueId}'s regional manager hasn't started yet.`}{" "}
          <button type="button" className="underline underline-offset-2" onClick={onBack}>
            See every regional manager
          </button>
        </Note>
      )}
      {threadId !== null && <Note>{link.issueId} opens in its regional manager&apos;s thread.</Note>}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Asks the manager's thread for the issue's tab and opens the thread, once per page. why once: every
 * call navigates, so a later read would pull the user back to it. why the list first, in this page's
 * place in the history: bb opens a thread as a new entry, and Back to this page would open the thread
 * again, so Back never got past it; the list, which takes its place, opens nothing.
 */
function useOpenOnce(threadId: string | null, { issueId }: IssueLink): void {
  const navigate = useBbNavigate();
  const opened = useRef(false);
  useEffect(() => {
    if (threadId === null || opened.current) return;
    opened.current = true;
    openIssueTabIn(threadId, issueId);
    navigate.toPluginPanel(PANEL_PATH, { replace: true });
    navigate.toThread(threadId);
  }, [threadId, issueId, navigate]);
}

const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-muted-foreground">{children}</p>;
