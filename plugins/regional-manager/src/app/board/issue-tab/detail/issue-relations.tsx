import type { IssueRow } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { StatusGlyph } from "../../issue/status-glyph.tsx";
import { useOpenIssue } from "../open-issue.ts";

type IssueRelationsProps = {
  issue: IssueRow;
  dependsOn: readonly IssueId[];
  blocks: readonly IssueId[];
  /** Every issue on the board, for each related issue's title and status. */
  issues: readonly IssueRow[];
};

type Shown = { id: IssueId; row: IssueRow | null; through: string | null };

export function IssueRelations({ issue, dependsOn, blocks, issues }: IssueRelationsProps) {
  const rowOf = (id: IssueId): IssueRow | null => issues.find((each) => each.id === id) ?? null;
  const shown = (ids: readonly IssueId[], through: string | null = null): Shown[] => ids.map((id) => ({ id, row: rowOf(id), through }));
  const parent = issue.parentId === null ? null : rowOf(issue.parentId);
  const inherited = parent === null ? [] : shown(parent.blockedBy.filter((id) => !dependsOn.includes(id)), `through ${parent.id}`);
  const subIssues = issues.filter(({ parentId }) => parentId === issue.id).map(({ id }) => id);
  return (
    <>
      <Relation title="Parent" related={shown(issue.parentId === null ? [] : [issue.parentId])} />
      <Relation title="Sub-issues" related={shown(subIssues)} />
      <Relation title="Depends on" related={[...shown(dependsOn), ...inherited]} />
      <Relation title="Blocks" related={shown(blocks)} />
    </>
  );
}

function Relation({ title, related }: { title: string; related: readonly Shown[] }) {
  const open = useOpenIssue();
  if (related.length === 0) return null;
  return (
    <section className="rmi-part">
      <h3 className="rmi-part-title">{title}</h3>
      <ul className="rmi-related-list">
        {related.map(({ id, row, through }) => (
          <li key={id}>
            {row === null ? (
              <span className="rmi-related">
                <span className="rmi-id">{id}</span>
                {through !== null && <span className="rmi-related-through">{through}</span>}
              </span>
            ) : (
              <button type="button" className="rmi-related" aria-label={[`${id}: ${row.title}`, STATUS_LABELS[row.status], ...(through === null ? [] : [through])].join(", ")} onClick={() => open(row)}>
                <StatusGlyph status={row.status} still />
                <span className="rmi-id">{id}</span>
                <span className="rmi-related-title">{row.title}</span>
                {through !== null && <span className="rmi-related-through">{through}</span>}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
