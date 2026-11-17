// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A row opens its detail in place under it;
// the detail is drawn only while it is open, so the caller reads it only then. Decisions keep their
// own row, the caller's. Which lanes are folded and which rows are open outlive a row moving lanes,
// and so does focus: on the row where it lands, or on its lane's header while that lane is folded.
// A detail goes to another issue the same way: its lane unfolds, its row opens and takes focus.
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
  /** An open issue's detail, under its row; `goTo`, to go to another issue on the board. */
  detailOf(issue: Row, goTo: GoTo): ReactNode;
};

/** Goes to an issue on the board: unfolds its lane, opens its row and moves focus to it. */
export type GoTo = (id: IssueId) => void;

export function IssueBoard({ decisions, issues, decisionRow, detailOf }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const [folded, setFolded] = useState(FOLDED_AT_FIRST);
  const [opened, setOpened] = useState(NONE_OPEN);
  const groups = boardGroups(decisions, issues);
  const laneOfKey = (key: string): Lane | null => groups.find(({ rows }) => rows.some((entry) => keyOf(entry) === key))?.lane ?? null;
  const focus = useFocusKeptAcrossGroups(laneOfKey);

  const goTo: GoTo = (id) => {
    const lane = laneOfKey(id);
    if (lane !== null) setFolded((current) => without(current, lane));
    setOpened((current) => new Set(current).add(id));
    focus.moveTo(id);
  };

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision, focus.target(entry.decision.id));
      case "issue":
        return <IssueItem issue={entry.issue} open={opened.has(entry.issue.id)} onToggle={() => setOpened((current) => toggled(current, entry.issue.id))} rowRef={focus.target(entry.issue.id)} detail={(issue) => detailOf(issue, goTo)} />;
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
            <LaneHeader ref={focus.header(lane)} id={headerId} listId={`${headerId}-list`} glyph={laneGlyph(lane)} name={LANE_LABELS[lane]} count={rows.length} open={open} onToggle={() => setFolded((current) => toggled(current, lane))} />
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

type IssueItemProps = { issue: Row; open: boolean; onToggle(): void; rowRef: RefCallback<HTMLElement>; detail(issue: Row): ReactNode };

/**
 * An issue's row, and its detail under it while open. The open row shows its title and headline whole,
 * so the detail doesn't repeat them; why named by id alone: the row just before it speaks the title.
 */
function IssueItem({ issue, open, onToggle, rowRef, detail }: IssueItemProps) {
  const detailId = useId();
  return (
    <>
      <IssueRow ref={rowRef} issue={issue} open={open} detailId={detailId} onToggle={onToggle} />
      {open && (
        <div id={detailId} role="region" aria-label={issue.id} className="rmi-detail">
          {detail(issue)}
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

/** The set with `key` taken out if it was in, else put in. */
function toggled<Key>(keys: ReadonlySet<Key>, key: Key): ReadonlySet<Key> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** The set with `key` taken out. */
function without<Key>(keys: ReadonlySet<Key>, key: Key): ReadonlySet<Key> {
  const next = new Set(keys);
  next.delete(key);
  return next;
}

/** A lane's glyph names its status, so it stands still; Needs you has its own. */
const laneGlyph = (lane: Lane): ReactNode => (lane === "needs-you" ? <NeedsYouGlyph /> : <StatusGlyph status={lane} still />);
