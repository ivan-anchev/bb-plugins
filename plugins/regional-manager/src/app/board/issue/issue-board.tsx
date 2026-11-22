// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A parent's sub-issues sit one level in under
// its row, in its lane, and a flagged one under Needs you as well. A row opens its detail in place under it;
// the detail is drawn only while it is open, so the caller reads it only then. A decision waiting for
// the user keeps its own row, the caller's, under Needs you; answered, it leaves the board, and focus
// in it goes to the page. Which lanes are folded and which rows are open outlive a row moving lanes,
// and so does focus: on the row where it lands, or on its lane's header while that lane is folded.
// A detail goes to another issue the same way: its lane unfolds, its row opens and takes focus, and it
// scrolls to the top of the page with its detail under it.
import "./issue-board.css";
import { useId, useState, type ReactNode, type RefCallback } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { boardGroups, LANE_LABELS, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision, OpenDecision } from "../../../model/decision.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { IssueRow } from "./issue-row.tsx";
import { LaneHeader } from "./lane-header.tsx";
import { revealAtTop } from "./motion/reveal.ts";
import { NeedsYouGlyph, StatusGlyph } from "./status-glyph.tsx";

type IssueBoardProps = {
  decisions: readonly Decision[];
  issues: readonly Row[];
  /** A decision's row, while it waits for the user's answer. */
  decisionRow(decision: OpenDecision): ReactNode;
  /** An open issue's detail, under its row; `under`, the parent its row is shown away from (null: none); `goTo`, to go to another issue on the board. */
  detailOf(issue: Row, under: IssueId | null, goTo: GoTo): ReactNode;
};

/** Goes to an issue on the board: unfolds its lane, opens its row, moves focus to it and scrolls it to the top. */
export type GoTo = (id: IssueId) => void;

export function IssueBoard({ decisions, issues, decisionRow, detailOf }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const [folded, setFolded] = useState(FOLDED_AT_FIRST);
  const [opened, setOpened] = useState(NONE_OPEN);
  const groups = boardGroups(decisions, issues);
  // why only the rows an issue lives in: a flagged sub-issue's copy under Needs you is not where it lives, its parent's lane is.
  const laneOfKey = (key: string): Lane | null => groups.find(({ rows }) => rows.some((entry) => livesIn(entry).includes(key)))?.lane ?? null;
  const focus = useFocusKeptAcrossGroups(laneOfKey);

  const goTo: GoTo = (id) => {
    const lane = laneOfKey(id);
    if (lane !== null) setFolded((current) => without(current, lane));
    setOpened((current) => new Set(current).add(id));
    focus.moveTo(id, revealAtTop);
  };

  /** An issue's row and its detail, opened by `rowKey`; why a key apart from its id: a flagged sub-issue has two rows, each opening on its own. */
  const issueItem = (issue: Row, rowKey: string, under: IssueId | null = null) => (
    <IssueItem issue={issue} under={under} open={opened.has(rowKey)} onToggle={() => setOpened((current) => toggled(current, rowKey))} rowRef={focus.target(rowKey)} detail={(shown) => detailOf(shown, under, goTo)} />
  );

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision);
      case "issue":
        return (
          <>
            {issueItem(entry.issue, entry.issue.id)}
            {entry.subIssues.length > 0 && (
              <ul className="rmi-list rmi-sub-issues">
                {entry.subIssues.map((sub) => (
                  <li key={sub.id} ref={focus.item(sub.id)}>
                    {issueItem(sub, sub.id)}
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      case "flagged-sub-issue":
        return issueItem(entry.issue, rowKeyOf(entry), entry.issue.parentId);
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
                  <li key={rowKeyOf(entry)} ref={focus.item(idOf(entry))}>
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

type IssueItemProps = { issue: Row; under: IssueId | null; open: boolean; onToggle(): void; rowRef: RefCallback<HTMLElement>; detail(issue: Row): ReactNode };

/**
 * An issue's row, and its detail under it while open. The open row shows its title and headline whole,
 * so the detail doesn't repeat them; why named by id alone: the row just before it speaks the title.
 */
function IssueItem({ issue, under, open, onToggle, rowRef, detail }: IssueItemProps) {
  const detailId = useId();
  return (
    <>
      <IssueRow ref={rowRef} issue={issue} under={under} open={open} detailId={detailId} onToggle={onToggle} />
      {open && (
        <div id={detailId} role="region" aria-label={issue.id} className="rmi-detail">
          {detail(issue)}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

/** The decision's or the issue's id. why one key space: decision and issue ids never collide (`d1`, `BBP-1`). */
const idOf = (entry: BoardItem<Row>): string => (entry.kind === "decision" ? entry.decision.id : entry.issue.id);

/** A row's own key: its id, but for a flagged sub-issue's copy under Needs you, which its issue's row under its parent already holds. */
const rowKeyOf = (entry: BoardItem<Row>): string => (entry.kind === "flagged-sub-issue" ? `${entry.issue.id} under Needs you` : idOf(entry));

/** The ids of what lives in a row: a decision, or an issue and its sub-issues; none for a flagged sub-issue's copy. */
function livesIn(entry: BoardItem<Row>): string[] {
  switch (entry.kind) {
    case "decision":
      return [entry.decision.id];
    case "issue":
      return [entry.issue.id, ...entry.subIssues.map(({ id }) => id)];
    case "flagged-sub-issue":
      return [];
    default:
      return entry satisfies never;
  }
}

/** The lanes that start folded: nothing is left to do in them. */
const FOLDED_AT_FIRST: ReadonlySet<Lane> = new Set(["backlog", "done", "canceled"]);
const NONE_OPEN: ReadonlySet<string> = new Set();

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
