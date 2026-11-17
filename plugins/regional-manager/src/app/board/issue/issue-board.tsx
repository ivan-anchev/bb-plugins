// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A row opens its detail in place under it;
// the detail is drawn only while it is open, so the caller reads it only then. Decisions keep their
// own row, the caller's. Which lanes are folded and which rows are open outlive a row moving lanes,
// and so does focus: on the row where it lands, or on its lane's header while that lane is folded.
import "./issue-board.css";
import { useId, useState, type ReactNode, type RefCallback } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { boardGroups, LANE_LABELS, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision } from "../../../model/decision.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { IssueRow } from "./issue-row.tsx";
import { LaneHeader } from "./lane-header.tsx";
import { NeedsYouGlyph, StatusGlyph } from "./status-glyph.tsx";

type IssueBoardProps = {
  decisions: readonly Decision[];
  issues: readonly Row[];
  /** A decision's row; `ref`, on the element that takes focus once it moves from Needs you to Done. */
  decisionRow(decision: Decision, ref: RefCallback<HTMLElement>): ReactNode;
  /** An open issue's detail, under its row. */
  detailOf(issue: Row): ReactNode;
};

export function IssueBoard({ decisions, issues, decisionRow, detailOf }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const [folded, toggleFolded] = useToggles<Lane>(FOLDED_AT_FIRST);
  const [opened, toggleOpened] = useToggles<IssueId>(NONE_OPEN);
  const groups = boardGroups(decisions, issues);
  const focus = useFocusKeptAcrossGroups((key) => groups.find(({ rows }) => rows.some((entry) => keyOf(entry) === key))?.lane ?? null);

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision, focus.target(entry.decision.id));
      case "issue":
        return <IssueItem issue={entry.issue} open={opened.has(entry.issue.id)} onToggle={() => toggleOpened(entry.issue.id)} rowRef={focus.target(entry.issue.id)} detailOf={detailOf} />;
      default:
        return entry satisfies never;
    }
  }

  return (
    <div className="rmi-board">
      {groups.map(({ lane, rows }) => {
        const open = !folded.has(lane);
        const headerId = `${ids}-${lane}`;
        return (
          <section key={lane} aria-labelledby={headerId} className="rmi-lane-section">
            <LaneHeader ref={focus.header(lane)} id={headerId} listId={`${headerId}-list`} glyph={laneGlyph(lane)} name={LANE_LABELS[lane]} count={rows.length} open={open} onToggle={() => toggleFolded(lane)} />
            {open && (
              <ul id={`${headerId}-list`} className="rmi-list">
                {rows.map((entry) => (
                  <li key={keyOf(entry)} ref={focus.item(keyOf(entry))}>
                    {item(entry)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

type IssueItemProps = { issue: Row; open: boolean; onToggle(): void; rowRef: RefCallback<HTMLElement>; detailOf: IssueBoardProps["detailOf"] };

/**
 * An issue's row, and its detail under it while open, which starts with the title and headline whole:
 * the row fades both out at its edge.
 */
function IssueItem({ issue, open, onToggle, rowRef, detailOf }: IssueItemProps) {
  const detailId = useId();
  return (
    <>
      <IssueRow ref={rowRef} issue={issue} open={open} detailId={detailId} onToggle={onToggle} />
      {open && (
        <div id={detailId} role="region" aria-label={`${issue.id}: ${issue.title}`} className="rmi-detail">
          <div className="rmi-detail-head">
            <p className="rmi-detail-title">{issue.title}</p>
            <p className="rmi-detail-headline">{issue.headline}</p>
          </div>
          {detailOf(issue)}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

/** An item's key on the board. why one key space: decision and issue ids never collide (`d1`, `i1`). */
const keyOf = (entry: BoardItem<Row>): string => (entry.kind === "decision" ? entry.decision.id : entry.issue.id);

/** The lanes that start folded: nothing is left to do in them. */
const FOLDED_AT_FIRST: ReadonlySet<Lane> = new Set(["backlog", "done", "canceled"]);
const NONE_OPEN: ReadonlySet<IssueId> = new Set();

/** A set the user adds to and takes from, one key at a time. */
function useToggles<Key>(initial: ReadonlySet<Key>): [ReadonlySet<Key>, (key: Key) => void] {
  const [keys, setKeys] = useState(initial);
  const toggle = (key: Key) =>
    setKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return [keys, toggle];
}

/** A lane's glyph names its status, so it stands still; Needs you has its own. */
const laneGlyph = (lane: Lane): ReactNode => (lane === "needs-you" ? <NeedsYouGlyph /> : <StatusGlyph status={lane} still />);
