// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A parent's sub-issues sit one level in under
// its row, in its lane, and a flagged one under Needs you as well. A row opens its issue's own tab
// (issue-row.tsx). A decision waiting for the user keeps its own row, the caller's, under Needs you;
// answered, it leaves the board, and focus in it goes to the page. Which lanes are folded outlives a
// row moving lanes, and so does focus: on the row where it lands, or on its lane's header while that
// lane is folded.
import "./issue-board.css";
import { useId, useState, type ReactNode } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { boardGroups, LANE_LABELS, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision, OpenDecision } from "../../../model/decision.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { IssueRow } from "./issue-row.tsx";
import { LaneHeader } from "./lane-header.tsx";
import { NeedsYouGlyph, StatusGlyph } from "./status-glyph.tsx";

type IssueBoardProps = {
  decisions: readonly Decision[];
  issues: readonly Row[];
  /** A decision's row, while it waits for the user's answer. */
  decisionRow(decision: OpenDecision): ReactNode;
};

export function IssueBoard({ decisions, issues, decisionRow }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const [folded, setFolded] = useState(FOLDED_AT_FIRST);
  const groups = boardGroups(decisions, issues);
  // why only the rows an issue lives in: a flagged sub-issue's copy under Needs you is not where it lives, its parent's lane is.
  const laneOfKey = (key: string): Lane | null => groups.find(({ rows }) => rows.some((entry) => livesIn(entry).includes(key)))?.lane ?? null;
  const focus = useFocusKeptAcrossGroups(laneOfKey);

  /** An issue's row, focused by `rowKey`; why a key apart from its id: a flagged sub-issue has two rows, each taking focus on its own. */
  const issueRow = (issue: Row, rowKey: string, under: IssueId | null = null) => <IssueRow ref={focus.target(rowKey)} issue={issue} under={under} />;

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision);
      case "issue":
        return (
          <>
            {issueRow(entry.issue, entry.issue.id)}
            {entry.subIssues.length > 0 && (
              <ul className="rmi-list rmi-sub-issues">
                {entry.subIssues.map((sub) => (
                  <li key={sub.id} ref={focus.item(sub.id)}>
                    {issueRow(sub, sub.id)}
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      case "flagged-sub-issue":
        return issueRow(entry.issue, rowKeyOf(entry), entry.issue.parentId);
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

/** The set with `key` taken out if it was in, else put in. */
function toggled<Key>(keys: ReadonlySet<Key>, key: Key): ReadonlySet<Key> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** A lane's glyph names its status, so it stands still; Needs you has its own. */
const laneGlyph = (lane: Lane): ReactNode => (lane === "needs-you" ? <NeedsYouGlyph /> : <StatusGlyph status={lane} still />);
