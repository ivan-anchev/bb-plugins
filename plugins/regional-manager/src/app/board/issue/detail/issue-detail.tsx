// An issue opened in place, read when its row opens: its description, its relations, its criteria,
// a build parent's final checks, and its record: every agent that held it, each handoff it made and
// the verdict on it.
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { coordinatorContract as contract, type IssueDetail as Detail, type IssueRow } from "../../../../contract.ts";
import { isVerified } from "../../../../model/issue/kind.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { ReadFailure } from "../../../ui/read-failure.tsx";
import type { GoTo } from "../issue-board.tsx";
import { FinalChecks } from "./final-checks.tsx";
import { IssueRecord } from "./issue-record.tsx";
import { IssueRelations } from "./issue-relations.tsx";

type IssueDetailProps = {
  coordinatorId: CoordinatorId;
  issue: IssueRow;
  /** The parent its row is shown away from, else null (issue-relations.tsx). */
  under: IssueId | null;
  /** Every issue on the board, which its relations name. */
  issues: readonly IssueRow[];
  goTo: GoTo;
};

export function IssueDetail({ coordinatorId, issue, under, issues, goTo }: IssueDetailProps) {
  const read = experimental_useRpcQuery({ contract, method: "issue", input: { coordinatorId, issueId: issue.id } });
  return (
    <>
      {read.error !== null && <ReadFailure onRetry={() => void read.refetch()}>Could not read {issue.id}: {read.error.message}</ReadFailure>}
      {read.data === undefined && read.error === null && <p className="rmi-description">Loading…</p>}
      {read.data !== undefined && <Opened issue={issue} under={under} detail={read.data} issues={issues} goTo={goTo} />}
    </>
  );
}

function Opened({ issue, under, detail: { description, doneCriteria, dependsOn, blocks, record, finalChecks }, issues, goTo }: Omit<IssueDetailProps, "coordinatorId"> & { detail: Detail }) {
  return (
    <>
      <p className="rmi-description">{description}</p>
      <IssueRelations issue={issue} under={under} dependsOn={dependsOn} blocks={blocks} issues={issues} goTo={goTo} />
      {doneCriteria.length > 0 && (
        <section className="rmi-part">
          {/* why by kind: a verified kind's criteria are judged; any other's are questions its report answers. */}
          <h3 className="rmi-part-title">{isVerified(issue.kind) ? "Done when" : "Questions"}</h3>
          <ol className="rmi-criteria">
            {doneCriteria.map((criterion, i) => (
              <li key={i}>{criterion}</li>
            ))}
          </ol>
        </section>
      )}
      {finalChecks.length > 0 && (
        <section className="rmi-part">
          <h3 className="rmi-part-title">Final checks</h3>
          <FinalChecks checks={finalChecks} />
        </section>
      )}
      {record.length > 0 && (
        <section className="rmi-part">
          <h3 className="rmi-part-title">Record</h3>
          <IssueRecord record={record} />
        </section>
      )}
    </>
  );
}
