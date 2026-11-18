// An open issue's relations: what it depends on and what depends on it, and its parent where its row
// is away from it, each the other issue's status glyph, id and title as its own row shows them;
// pressing one goes to that issue on the board. A relation with no issue in it has no section. why no
// sub-issues, and no parent under it: the rows nest them already, right there.
import type { IssueRow } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import type { GoTo } from "../issue-board.tsx";
import { StatusGlyph } from "../status-glyph.tsx";

type IssueRelationsProps = {
  issue: IssueRow;
  /** The parent its row is shown away from (the flagged copy under Needs you), else null. */
  under: IssueId | null;
  dependsOn: readonly IssueId[];
  blocks: readonly IssueId[];
  /** Every issue on the board, for each related issue's title and status. */
  issues: readonly IssueRow[];
  goTo: GoTo;
};

/** A related issue, and why it is related when its section doesn't say (null: it does). */
type Shown = { issue: IssueRow; through: string | null };

export function IssueRelations({ issue, under, dependsOn, blocks, issues, goTo }: IssueRelationsProps) {
  // why skip an id the rows lack: the detail and the board read apart, so a detail can name an issue filed since the board's last read.
  const shown = (ids: readonly IssueId[], through: string | null = null): Shown[] => ids.flatMap((id) => issues.filter((each) => each.id === id).map((each) => ({ issue: each, through })));
  // why: a parent's dependencies block its sub-issues too; the row names them with its own, so the detail lists them all.
  const parents = issue.blockedBy.filter((id) => !dependsOn.includes(id));
  return (
    <>
      <Relation title="Parent" related={shown(under === null ? [] : [under])} goTo={goTo} />
      <Relation title="Depends on" related={[...shown(dependsOn), ...shown(parents, `through ${issue.parentId}`)]} goTo={goTo} />
      <Relation title="Blocks" related={shown(blocks)} goTo={goTo} />
    </>
  );
}

function Relation({ title, related, goTo }: { title: string; related: readonly Shown[]; goTo: GoTo }) {
  if (related.length === 0) return null;
  return (
    <section className="rmi-part">
      <h3 className="rmi-part-title">{title}</h3>
      <ul className="rmi-related-list">
        {related.map(({ issue: { id, title: name, status }, through }) => (
          <li key={id}>
            <button type="button" className="rmi-related" aria-label={[`${id}: ${name}`, STATUS_LABELS[status], ...(through === null ? [] : [through])].join(", ")} onClick={() => goTo(id)}>
              <StatusGlyph status={status} still />
              <span className="rmi-id">{id}</span>
              <span className="rmi-related-title">{name}</span>
              {through !== null && <span className="rmi-related-through">{through}</span>}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
