// An issue opened in place: its description, its criteria, its relations when it has any, and its
// record: every agent that held it, each handoff it made and the verdict on it.
import { isVerified } from "../../../model/issue/kind.ts";
import type { IssueDetailData, Relations } from "./board-issue.ts";
import { IssueRecord } from "./issue-record.tsx";

export function IssueDetail({ kind, description, doneCriteria, relations, record }: IssueDetailData) {
  return (
    <>
      <p className="rmi-description">{description}</p>
      {doneCriteria.length > 0 && (
        <section className="rmi-part">
          {/* why by kind: a verified kind's criteria are judged; any other's are questions its report answers. */}
          <h3 className="rmi-part-title">{isVerified(kind) ? "Done when" : "Questions"}</h3>
          <ol className="rmi-criteria">
            {doneCriteria.map((criterion, i) => (
              <li key={i}>{criterion}</li>
            ))}
          </ol>
        </section>
      )}
      <RelationsPart relations={relations} />
      {record.length > 0 && (
        <section className="rmi-part">
          <h3 className="rmi-part-title">Record</h3>
          <IssueRecord record={record} />
        </section>
      )}
    </>
  );
}

/** Its parent, sub-issues and dependencies both ways; nothing when it has none. */
function RelationsPart({ relations }: { relations: Relations }) {
  const lines = [
    { label: "Parent", ids: relations.parentId === null ? [] : [relations.parentId] },
    { label: "Sub-issues", ids: relations.subIssues },
    { label: "Depends on", ids: relations.dependsOn },
    { label: "Blocks", ids: relations.blocks },
  ].filter((line) => line.ids.length > 0);
  if (lines.length === 0) return null;
  return (
    <section className="rmi-part">
      <h3 className="rmi-part-title">Relations</h3>
      <dl className="rmi-relations">
        {lines.map(({ label, ids }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{ids.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
