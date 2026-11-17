// An open issue's relations: what it depends on and what depends on it, each the other issue's status
// glyph, id and title as its own row shows them; pressing one goes to that issue on the board. A
// relation with no issue in it has no section.
import type { IssueRow } from "../../../../contract.ts";
import type { IssueId } from "../../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import type { GoTo } from "../issue-board.tsx";
import { StatusGlyph } from "../status-glyph.tsx";

type IssueRelationsProps = {
  dependsOn: readonly IssueId[];
  blocks: readonly IssueId[];
  /** Every issue on the board, for each related issue's title and status. */
  issues: readonly IssueRow[];
  goTo: GoTo;
};

export function IssueRelations({ dependsOn, blocks, issues, goTo }: IssueRelationsProps) {
  // why skip an id the rows lack: the detail and the board read apart, so a detail can name an issue filed since the board's last read.
  const shown = (ids: readonly IssueId[]) => ids.flatMap((id) => issues.filter((issue) => issue.id === id));
  return (
    <>
      <Relation title="Depends on" related={shown(dependsOn)} goTo={goTo} />
      <Relation title="Blocks" related={shown(blocks)} goTo={goTo} />
    </>
  );
}

function Relation({ title, related, goTo }: { title: string; related: readonly IssueRow[]; goTo: GoTo }) {
  if (related.length === 0) return null;
  return (
    <section className="rmi-part">
      <h3 className="rmi-part-title">{title}</h3>
      <ul className="rmi-related-list">
        {related.map(({ id, title: name, status }) => (
          <li key={id}>
            <button type="button" className="rmi-related" aria-label={`${id}: ${name}, ${STATUS_LABELS[status]}`} onClick={() => goTo(id)}>
              <StatusGlyph status={status} still />
              <span className="rmi-id">{id}</span>
              <span className="rmi-related-title">{name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
