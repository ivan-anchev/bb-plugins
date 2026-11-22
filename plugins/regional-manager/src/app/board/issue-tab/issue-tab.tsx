import "../issue/issue-board.css";
import "./issue-tab.css";
import { experimental_useRpcQuery, type ExperimentalThreadTabProps, type JsonValue } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { coordinatorContract as contract } from "../../../contract.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { useCoordinatorOfThread, useIsManagerThread } from "../../profile/use-manager.ts";
import { ReadFailure } from "../../ui/read-failure.tsx";
import { TabPage } from "../../ui/tab-page.tsx";
import { IssueDetail } from "./detail/issue-detail.tsx";
import { IssueHeader } from "./issue-header.tsx";
import { ISSUE_TAB, issueTabParamsSchema } from "./open-issue.ts";

export const issueTab = {
  ...ISSUE_TAB,
  title: "Issue",
  icon: "CircleDot",
  layout: "flush",
  component: IssueTab,
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

function IssuePage({ coordinatorId, issueId }: { coordinatorId: CoordinatorId; issueId: IssueId }) {
  const read = experimental_useRpcQuery({ contract, method: "board", input: { coordinatorId } });
  const issues = read.data?.issues;
  const issue = issues?.find(({ id }) => id === issueId);
  return (
    <>
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {issueId}: {read.error.message}</ReadFailure>}
      {issues === undefined && read.error === null && <Note>Loading {issueId}…</Note>}
      {issues !== undefined && issue === undefined && <Note>This regional manager has no issue {issueId}.</Note>}
      {issues !== undefined && issue !== undefined && (
        <article aria-label={issue.id} className="rmi-detail">
          <IssueHeader issue={issue} />
          <IssueDetail coordinatorId={coordinatorId} issue={issue} issues={issues} />
        </article>
      )}
    </>
  );
}

const Note = ({ children }: { children: ReactNode }) => <p className="px-2 text-sm text-muted-foreground">{children}</p>;
