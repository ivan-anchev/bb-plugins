// An issue's relations in its tab: its parent and its sub-issues, what it depends on and what depends
// on it, each the other issue's status glyph, id and title as its own row shows them; pressing one
// opens that issue's tab. An issue the board hasn't read yet shows by its id alone, nothing to press,
// until the board's next read brings its row. A relation with no issue in it has no section.
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

/** A related issue: its row on the board, null until the board reads it; and why it is related when its section doesn't say (null: it does). */
type Shown = { id: IssueId; row: IssueRow | null; through: string | null };

export function IssueRelations({ issue, dependsOn, blocks, issues }: IssueRelationsProps) {
  // why an id the rows lack: the detail and the board read apart, so a detail can name an issue filed since the board's last read.
  const rowOf = (id: IssueId): IssueRow | null => issues.find((each) => each.id === id) ?? null;
  const shown = (ids: readonly IssueId[], through: string | null = null): Shown[] => ids.map((id) => ({ id, row: rowOf(id), through }));
  // why: a parent's open dependencies block its sub-issues too; the row names them with its own, so the
  // detail lists them all. why from the parent's row: only it says which are the parent's, where the
  // row's blockers less the detail's dependencies, two reads apart, would pass off one just removed.
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
                <StatusGlyph status={row.status} />
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
