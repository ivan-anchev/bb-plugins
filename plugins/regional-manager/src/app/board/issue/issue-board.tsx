// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A parent's sub-issues hang under its row on
// rails (row/sub-issue-tree.tsx), in its lane, and a flagged one sits under Needs you as well, with
// what it waits on the user for under its title. A row opens its issue's own tab (row/issue-row.tsx),
// and resting on it, or focusing it, opens its hover card (hover-card/). A decision waiting for the
// user keeps its own row, the caller's, under Needs you; answered, it leaves the board, and focus in
// it goes to the page. Which lanes are folded outlives a row moving lanes, and so does focus: on the
// row where it lands, or on its lane's header while that lane is folded.
import "./issue-board.css";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { boardGroups, LANE_LABELS, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision, OpenDecision } from "../../../model/decision.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { LaneHeader } from "../../ui/lane-header/lane-header.tsx";
import { HoverCard } from "./hover-card/hover-card.tsx";
import { useHoverCards } from "./hover-card/use-hover-card.ts";
import { IssueRow } from "./row/issue-row.tsx";
import { SubIssueTree } from "./row/sub-issue-tree.tsx";

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
  const cards = useHoverCards();

  /**
   * An issue's row, focused by `rowKey`, with its hover card while it shows; `ask`, what it waits on the
   * user for, under Needs you. why a key apart from its id: a flagged sub-issue has two rows, each
   * taking focus, and showing its card, on its own.
   */
  const issueRow = (issue: Row, rowKey: string, ask: string | null, under: Row["parentId"] = null) => (
    <IssueRow ref={focus.target(rowKey)} issue={issue} under={under} ask={ask} hover={cards.trigger(rowKey)}>
      {cards.shown === rowKey && <HoverCard issue={issue} issues={issues} />}
    </IssueRow>
  );

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision);
      case "issue": {
        const ask = entry.lane === "needs-you" ? entry.issue.needsYou : null;
        return (
          <>
            {issueRow(entry.issue, entry.issue.id, ask)}
            {entry.subIssues.length > 0 && (
              <SubIssueTree subIssues={entry.subIssues} keyOf={(sub) => sub.id} itemRef={(sub) => focus.item(sub.id)} parentAsks={ask !== null}>
                {(sub) => issueRow(sub, sub.id, null)}
              </SubIssueTree>
            )}
          </>
        );
      }
      case "flagged-sub-issue":
        return issueRow(entry.issue, rowKeyOf(entry), entry.issue.needsYou, entry.issue.parentId);
      default:
        return entry satisfies never;
    }
  }

  return (
    <div className="rmi-board" style={idColumn(issues)} {...cards.board}>
      {groups.map(({ lane, rows }) => {
        const open = !folded.has(lane);
        const headerId = `${ids}-${lane}`;
        return (
          <section key={lane} aria-labelledby={headerId} className="rmi-lane-section">
            <LaneHeader ref={focus.header(lane)} id={headerId} listId={`${headerId}-list`} name={LANE_LABELS[lane]} count={rows.length} open={open} onToggle={() => setFolded((current) => toggled(current, lane))} />
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

/** The ids' column, as wide as the board's longest id in mono, so every row's title starts at one line (row/issue-row.css `.rmi-row-id`). */
const idColumn = (issues: readonly Row[]): CSSProperties & Record<"--rmi-id-ch", number> => ({ "--rmi-id-ch": Math.max(0, ...issues.map(({ id }) => id.length)) });
