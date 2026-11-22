// Where an issue link lands when the chat overlay didn't catch it, as when bb followed it from a
// client that runs no overlay, or a pasted address: the panel's page at the link's route opens the
// regional manager's thread with the issue's tab open beside the Board (panes.tsx), or says why it
// can't. why the issue is checked here: a link outlives its issue's manager, which a user can delete.
import { experimental_useRpcQuery, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { coordinatorContract as contract } from "../../contract.ts";
import type { IssueLink } from "../../model/issue/link/issue-link.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { openIssueTabIn } from "./panes.tsx";

type IssueLandingProps = { ref: Ref<HTMLDivElement>; link: IssueLink; onBack(): void };

export function IssueLanding({ ref, link, onBack }: IssueLandingProps) {
  const read = experimental_useRpcQuery({ contract, method: "coordinators", input: {} });
  const coordinators = read.data?.coordinators;
  const threadId = coordinators?.find(({ id }) => id === link.coordinatorId)?.threadId ?? null;
  useOpenOnce(threadId, link);
  return (
    // why the tab stop: the page is text the keyboard reaches (REVIEW.md).
    <div ref={ref} tabIndex={0} className="flex h-full flex-col gap-3 bg-background px-6 py-6 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset">
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not open {link.issueId}: {read.error.message}</ReadFailure>}
      {coordinators === undefined && read.error === null && <Note>Opening {link.issueId}…</Note>}
      {coordinators !== undefined && threadId === null && (
        <Note>
          {link.issueId}&apos;s regional manager isn&apos;t running: it was deleted, or hasn&apos;t started.{" "}
          <button type="button" className="underline underline-offset-2" onClick={onBack}>
            See every regional manager
          </button>
        </Note>
      )}
      {threadId !== null && <Note>Opening {link.issueId} in its regional manager&apos;s thread…</Note>}
    </div>
  );
}

// ------------------------------------------------------------------ layer 2

/**
 * Asks the manager's thread for the issue's tab and opens the thread, once per page. why once: every
 * call navigates, so a later read would pull the user back to it.
 */
function useOpenOnce(threadId: string | null, { issueId }: IssueLink): void {
  const navigate = useBbNavigate();
  const opened = useRef(false);
  useEffect(() => {
    if (threadId === null || opened.current) return;
    opened.current = true;
    openIssueTabIn(threadId, issueId);
    navigate.toThread(threadId);
  }, [threadId, issueId, navigate]);
}

const Note = ({ children }: { children: ReactNode }) => <p className="m-0 text-muted-foreground">{children}</p>;
