// The board of one regional manager: its verification switch, a warning while its own working
// tree has changed files and why PR status is unavailable when it is, then the decisions waiting
// for the user and its issues in lanes (issue/issue-board.tsx), each issue opening in its own tab
// beside the Board (issue-tab/issue-tab.tsx). Its thread's Board tab draws it, in the scrolling root
// the tab gives it (board-tab.tsx).
import { experimental_Icon as Icon, experimental_useRpcMutation, experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { coordinatorContract as contract, type Board as BoardData } from "../../contract.ts";
import type { Decision } from "../../model/decision.ts";
import { filesText } from "../../model/inbox/own-tree.ts";
import type { CoordinatorId } from "../../model/role.ts";
import { ReadFailure } from "../ui/read-failure.tsx";
import { Switch } from "../ui/switch.tsx";
import { shortTime } from "../ui/time.ts";
import { useAnsweredDraftsDropped } from "./answer-draft.ts";
import { DecisionRow } from "./decision-row.tsx";
import { IssueBoard } from "./issue/issue-board.tsx";

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
          <VerifySwitch coordinatorId={coordinatorId} verify={data.verify} />
          {data.ownEdits !== null && <OwnEdits {...data.ownEdits} />}
          {data.prUnavailable !== null && <PrUnavailable reason={data.prUnavailable} />}
          <IssueBoard
            decisions={data.decisions}
            issues={data.issues}
            decisionRow={(decision) => <DecisionRow coordinatorId={coordinatorId} decision={decision} />}
          />
          {data.issues.length === 0 && <p className="px-2 text-sm text-muted-foreground">No issues yet.</p>}
        </>
      )}
    </div>
  );
}

/** No decisions read yet. why a constant: the drafts are dropped again only when a read changes the list. */
const NO_DECISIONS: readonly Decision[] = [];

/**
 * The board's switch for verifying done handoffs. It shows what the user asked for while the change
 * saves, and the stored value once the board reads it back.
 */
function VerifySwitch({ coordinatorId, verify }: { coordinatorId: CoordinatorId; verify: boolean }) {
  const save = experimental_useRpcMutation({ contract, method: "setVerify" });
  const [asked, setAsked] = useState<boolean | null>(null);
  // why during render: once the board reads back what was asked, the stored value takes over.
  if (asked !== null && asked === verify) setAsked(null);
  const shown = asked ?? verify;

  function change(next: boolean) {
    setAsked(next);
    save.mutate({ coordinatorId, verify: next }).catch(() => setAsked(null));
  }

  return (
    <div className="flex flex-col gap-1 px-2">
      <Switch
        checked={shown}
        onChange={change}
        pending={save.isPending}
        label="Verify done handoffs"
        hint={
          shown
            ? `A hidden reviewer reads each done handoff's diff as CREW.md says, then a hidden verifier checks it against its criteria and the review, each on another model when there is one, before the regional manager hears of it.`
            : `Done handoffs reach the regional manager unverified. Turning this on checks handoffs from then on.`
        }
      />
      {save.error !== null && (
        <p role="alert" className="pl-11 text-xs text-destructive-text">
          Could not change it: {save.error.message}
        </p>
      )}
    </div>
  );
}

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
 * Why the plugin can't read its issues' pull requests now. Rows keep the PR and CI it read last, and a
 * pass it couldn't check CI for says so.
 */
function PrUnavailable({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Icon name="AlertTriangle" aria-hidden className="mt-px size-3.5 shrink-0 text-warning-text" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">PR status unavailable:</span> {reason}. Rows show what was read last.
      </span>
    </p>
  );
}
