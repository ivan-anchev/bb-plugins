// An issue's detail, read when its tab opens, under its head: its description, its relations, and its
// feed (feed/feed.tsx), the grid of its criteria by round and its Activity. It reads its own issue
// alone, again only when that issue changes.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract, type IssueRow } from "../../../../contract.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { ReadFailure } from "../../../ui/read-failure.tsx";
import { Feed } from "../feed/feed.tsx";
import { IssueRelations } from "./issue-relations.tsx";

type IssueDetailProps = {
  coordinatorId: CoordinatorId;
  issue: IssueRow;
  /** Every issue on the board, which its relations name. */
  issues: readonly IssueRow[];
};

export function IssueDetail({ coordinatorId, issue, issues }: IssueDetailProps) {
  const read = experimental_useRpcQuery({ contract, method: "issueFeed", input: { coordinatorId, issueId: issue.id } });
  const feed = read.data;
  return (
    <>
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {issue.id}: {read.error.message}</ReadFailure>}
      {feed === undefined && read.error === null && <p className="rmi-description">Loading…</p>}
      {feed !== undefined && (
        <>
          <p className="rmi-description">{feed.description}</p>
          <IssueRelations issue={issue} dependsOn={feed.dependsOn} blocks={feed.blocks} issues={issues} />
          <Feed coordinatorId={coordinatorId} issue={issue} feed={feed} />
        </>
      )}
    </>
  );
}
