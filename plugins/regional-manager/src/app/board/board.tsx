// The board of one regional manager: whether its done handoffs are verified (verify-chip/), a warning
// while its own working tree has changed files and why PR status is unavailable when it is, then its
// issues in lanes (issue/issue-board.tsx), with any question on no issue under Needs you, each issue
// opening in its own tab beside the Board (issue-tab/issue-tab.tsx). Its thread's Board tab draws it,
// in the scrolling root the tab gives it (board-tab.tsx).
import { experimental_Icon as Icon, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract, type Board as BoardData } from "../../contract.ts";
import type { Decision } from "../../model/decision.ts";
import { filesText } from "../../model/inbox/own-tree.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { statusLabel } from "../../model/verdict/pr.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { shortTime } from "../ui/time.ts";
import { useAnsweredDraftsDropped } from "./answer-draft.ts";
import { IssueBoard } from "./issue/issue-board.tsx";
import { VerifyChip } from "./verify-chip/verify-chip.tsx";

export function Board({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const read = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } });
  useAnsweredDraftsDropped(coordinatorId, read.data?.decisions ?? NO_DECISIONS);
  const data = read.data;
  return (
    // why a container: the board is as narrow as a side panel in the Board tab, whatever the window's width.
    <div className="@container flex flex-col gap-6">
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read the board: {read.error.message}</ReadFailure>}
      {data === undefined && read.error === null && <p className="px-2 text-sm text-muted-foreground">Loading the board…</p>}
      {data !== undefined && (
        <>
          <VerifyChip coordinatorId={coordinatorId} verify={data.verify} />
          {data.ownEdits !== null && <OwnEdits {...data.ownEdits} />}
          {data.prUnavailable !== null && <PrUnavailable {...data.prUnavailable} />}
          <IssueBoard coordinatorId={coordinatorId} decisions={data.decisions} issues={data.issues} />
          {data.issues.length === 0 && <p className="px-2 text-sm text-muted-foreground">No issues yet.</p>}
        </>
      )}
    </div>
  );
}

/** No decisions read yet. why a constant: the drafts are dropped again only when a read changes the list. */
const NO_DECISIONS: readonly Decision[] = [];

/**
 * Files changed in the regional manager's own working tree when a turn of its ended. Its rules
 * say it never edits project files, and bb can't stop it, so the plugin tells it and the user. It
 * goes once a turn of its ends with the tree clean.
 */
function OwnEdits({ fileCount, at }: NonNullable<BoardData["ownEdits"]>) {
  return (
    <p className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">
          {filesText(fileCount)} changed in the regional manager's own environment
        </span>{" "}
        when its turn ended at <time dateTime={new Date(at).toISOString()}>{shortTime(at)}</time>. Its rules forbid editing project files, so it was told to hand the change to an agent.
      </span>
    </p>
  );
}

/**
 * Why the plugin can't read its issues' pull requests or merge requests now, under its forge's label.
 * Rows keep the PR and CI it read last, and a pass it couldn't check CI for says so.
 */
function PrUnavailable({ forge, reason }: NonNullable<BoardData["prUnavailable"]>) {
  return (
    <p className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{statusLabel(forge)}:</span> {reason}. Rows show what was read last.
      </span>
    </p>
  );
}
