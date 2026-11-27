// An issue's own tab in its regional manager's side panel, beside the Board: one tab per issue, opened
// from its row on the board or from its entry in another issue's tab (open-issue.ts). It reads the
// board as the Board tab does, for the issue's row and the rows its relations name, so it changes as
// the board does; its detail reads the issue itself.
import "../issue/issue-board.css";
import "./issue-tab.css";
import type { ExperimentalThreadTabProps, JsonValue } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { useCoordinatorOfThread, useIsManagerThread } from "../../profile/use-manager.ts";
import { ReadFailure } from "../../ui/read-failure.tsx";
import { TabPage } from "../../ui/tab-page.tsx";
import { useBoardIssue } from "../use-board-issue.ts";
import { IssueDetail } from "./detail/issue-detail.tsx";
import { ISSUE_TAB, issueTabParamsSchema } from "./open-issue.ts";

export const issueTab = {
  ...ISSUE_TAB,
  title: "Issue",
  icon: "CircleDot",
  layout: "flush",
  component: IssueTab,
  // why the Board's: bb declines to open a tab where it is hidden, and an issue lives where its board does.
  useVisible: useIsManagerThread,
} as const;

function IssueTab({ threadId, params }: ExperimentalThreadTabProps & { params: JsonValue | null }) {
  const { read, coordinator } = useCoordinatorOfThread(threadId);
  const opened = issueTabParamsSchema.safeParse(params);
  return (
    <TabPage>
      {!opened.success && <Note>Open an issue from its row on the Board.</Note>}
      {opened.success && read.error !== null && coordinator === null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {opened.data.issueId}: {read.error.message}</ReadFailure>}
      {opened.success && coordinator !== null && <IssuePage key={coordinator.id} coordinatorId={coordinator.id} issueId={opened.data.issueId} />}
    </TabPage>
  );
}

/** The issue, from the board's read: its head and its detail, and whatever failed to read beside them. */
function IssuePage({ coordinatorId, issueId }: { coordinatorId: CoordinatorId; issueId: IssueId }) {
  const { read, issues, issue } = useBoardIssue(coordinatorId, issueId);
  return (
    <>
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {issueId}: {read.error.message}</ReadFailure>}
      {issues === undefined && read.error === null && <Note>Loading {issueId}…</Note>}
      {issues !== undefined && issue === undefined && <Note>This regional manager has no issue {issueId}.</Note>}
      {issues !== undefined && issue !== undefined && (
        <article aria-label={issue.id} className="rmi-detail">
          <IssueDetail coordinatorId={coordinatorId} issue={issue} issues={issues} />
        </article>
      )}
    </>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="px-2 text-sm text-muted-foreground">{children}</p>;
