// An issue's head and its detail, read when its tab opens: its head with every agent that held it,
// then its description and its brief folded, as Markdown, its relations, and its feed (feed/feed.tsx), the grid of its
// criteria by round and its Activity. It reads its own issue alone, again only when that issue changes.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract, type IssueRow } from "../../../../contract.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { ReadFailure } from "../../../ui/read-failure.tsx";
import { TabMarkdown } from "../../../ui/tab-markdown/tab-markdown.tsx";
import { IssueHeader } from "../issue-header.tsx";
import { DiscloseGlyph } from "./disclose-glyph.tsx";
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
      <IssueHeader issue={issue} agents={feed?.agents ?? null} />
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {issue.id}: {read.error.message}</ReadFailure>}
      {feed === undefined && read.error === null && <p className="rmi-description">Loading…</p>}
      {feed !== undefined && (
        <>
          <div className="rmi-description">
            <TabMarkdown text={feed.description} />
          </div>
          {feed.brief !== null && <Brief brief={feed.brief} />}
          <IssueRelations issue={issue} dependsOn={feed.dependsOn} blocks={feed.blocks} issues={issues} />
          <Feed coordinatorId={coordinatorId} issue={issue} feed={feed} />
        </>
      )}
    </>
  );
}

/** The agent's brief, folded, as it is written. why folded: it runs to 20,000 characters, and the description says what the issue is about. */
function Brief({ brief }: { brief: string }) {
  return (
    <details className="rmi-report-fold rmi-brief">
      <summary>
        <DiscloseGlyph />
        Brief
      </summary>
      <div className="rmi-description">
        <TabMarkdown text={brief} />
      </div>
    </details>
  );
}
