// The board's lanes (board-groups.ts): Needs you on top, then a lane per status, each under a header
// that folds it. Backlog, Done and Canceled start folded. A parent's sub-issues hang under its row on
// rails (row/sub-issue-tree.tsx), in its lane, folded until its count on its row unfolds them
// (row/pills.tsx). A flagged sub-issue sits under Needs
// you as well, with what it waits on the user for under its title, and a canceled one under Canceled
// only. A row opens its issue's own tab (row/issue-row.tsx), and resting on it, or focusing it, opens
// its hover card (hover-card/); under Needs you, an issue a question waits on opens its tab at that
// question (issue-tab/question-reveal.ts). A question on no issue has its own row under Needs you
// (unfiled-question-row.tsx); answered, it leaves the board, and focus in it goes to the page. Which lanes,
// parents and completed rows are folded outlives a row moving lanes, while the board is open, and
// so does focus: on the row where it lands, or on its lane's header while that lane is folded.
import "./issue-board.css";
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { boardGroups, LANE_LABELS, waitingDecisions, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision } from "../../../model/decision.ts";
import type { CoordinatorId } from "../../../model/role.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { LaneHeader } from "../../ui/lane-header/lane-header.tsx";
import { useOpenIssue } from "../issue-tab/open-issue.ts";
import { revealQuestionOf } from "../issue-tab/question-reveal.ts";
import { HoverCard } from "./hover-card/hover-card.tsx";
import { useHoverCards } from "./hover-card/use-hover-card.ts";
import { IssueRow } from "./row/issue-row.tsx";
import type { SubIssueToggle } from "./row/pills.tsx";
import { SubIssueTree } from "./row/sub-issue-tree.tsx";
import { UnfiledQuestionRow } from "./unfiled-question-row.tsx";

type IssueBoardProps = { coordinatorId: CoordinatorId; decisions: readonly Decision[]; issues: readonly Row[] };

export function IssueBoard({ coordinatorId, decisions, issues }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const [folded, toggleLane] = useToggledSet(FOLDED_AT_FIRST);
  const [parentsOpen, toggleParent] = useToggledSet<IssueId>(NONE);
  const [completedShown, toggleCompleted] = useToggledSet<IssueId>(NONE);
  const groups = boardGroups(decisions, issues);
  // why only the rows an issue lives in: a flagged sub-issue's copy under Needs you is not where it lives, its parent's lane is.
  const laneOfKey = (key: string): Lane | null => groups.find(({ rows }) => rows.some((entry) => livesIn(entry).includes(key)))?.lane ?? null;
  const focus = useFocusKeptAcrossGroups(laneOfKey);
  const cards = useHoverCards();
  const open = useOpenIssue();
  const asking = new Set(waitingDecisions(decisions, issues).map(({ issueId }) => issueId));

  /** Opens the issue's tab; under Needs you (`ask`), at the question it waits on, if one does. */
  const opener = (issue: Row, ask: string | null) => () => {
    if (ask !== null && asking.has(issue.id)) revealQuestionOf(coordinatorId, issue.id);
    open(issue);
  };

  /**
   * An issue's row, focused by `rowKey`, with its hover card while it shows; `ask`, what it waits on the
   * user for, under Needs you; `under`, the parent it names away from it; `toggle`, what a parent's
   * count folds. why a key apart from its id: a flagged sub-issue has two rows, each taking focus, and
   * showing its card, on its own.
   */
  const issueRow = (issue: Row, rowKey: string, { ask = null, under = null, toggle = null }: Partial<RowPlace> = {}) => (
    <IssueRow ref={focus.target(rowKey)} issue={issue} under={under} ask={ask} toggle={toggle} onOpen={opener(issue, ask)} hover={cards.trigger(rowKey)}>
      {cards.shown === rowKey && <HoverCard issue={issue} issues={issues} presence={cards.presence(rowKey)} />}
    </IssueRow>
  );

  /** A top-level issue's row and, once its count unfolded them, its sub-issues under it; `ask`, under Needs you. */
  function parentRows(issue: Row, subIssues: readonly Row[], ask: string | null): ReactNode {
    const listId = `${ids}-${issue.id}-sub-issues`;
    const toggle: SubIssueToggle | null = subIssues.length === 0 ? null : { open: parentsOpen.has(issue.id), controls: listId, onToggle: () => toggleParent(issue.id) };
    return (
      <>
        {issueRow(issue, issue.id, { ask, toggle })}
        {toggle?.open === true && (
          <SubIssueTree
            id={listId}
            parent={issue}
            subIssues={subIssues}
            completed={{ open: completedShown.has(issue.id), onToggle: () => toggleCompleted(issue.id) }}
            itemRef={(sub) => focus.item(sub.id)}
            parentAsks={ask !== null}
          >
            {(sub) => issueRow(sub, sub.id)}
          </SubIssueTree>
        )}
      </>
    );
  }

  function item(entry: BoardItem<Row>): ReactNode {
    switch (entry.kind) {
      case "unfiled-question":
        return <UnfiledQuestionRow ref={focus.target(rowKeyOf(entry))} coordinatorId={coordinatorId} decision={entry.decision} />;
      case "issue":
        return parentRows(entry.issue, entry.subIssues, entry.lane === "needs-you" ? entry.issue.needsYou : null);
      case "flagged-sub-issue":
        return issueRow(entry.issue, rowKeyOf(entry), { ask: entry.issue.needsYou, under: entry.issue.parentId });
      case "canceled-sub-issue":
        return issueRow(entry.issue, rowKeyOf(entry), { under: entry.issue.parentId });
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
            <LaneHeader ref={focus.header(lane)} id={headerId} listId={`${headerId}-list`} name={LANE_LABELS[lane]} count={rows.length} open={open} onToggle={() => toggleLane(lane)} />
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

/** The question's or the issue's id. why one key space: decision and issue ids never collide (`d1`, `BBP-1`). */
const idOf = (entry: BoardItem<Row>): string => (entry.kind === "unfiled-question" ? entry.decision.id : entry.issue.id);

/** A row's own key: its id, but for a flagged sub-issue's copy under Needs you, which its issue's row under its parent already holds. */
const rowKeyOf = (entry: BoardItem<Row>): string => (entry.kind === "flagged-sub-issue" ? `${entry.issue.id} under Needs you` : idOf(entry));

/** The ids of what lives in a row: a question, an issue and its sub-issues, or a canceled sub-issue; none for a flagged sub-issue's copy. */
function livesIn(entry: BoardItem<Row>): string[] {
  switch (entry.kind) {
    case "unfiled-question":
      return [entry.decision.id];
    case "issue":
      return [entry.issue.id, ...entry.subIssues.map(({ id }) => id)];
    case "canceled-sub-issue":
      return [entry.issue.id];
    case "flagged-sub-issue":
      return [];
    default:
      return entry satisfies never;
  }
}

/** Where an issue's row sits, besides its lane: what it waits on the user for, the parent it names away from it, and what its count folds; each null when none. */
type RowPlace = { ask: string | null; under: IssueId | null; toggle: SubIssueToggle | null };

/** The lanes that start folded: nothing is left to do in them. */
const FOLDED_AT_FIRST: ReadonlySet<Lane> = new Set(["backlog", "done", "canceled"]);

/** No parent, and no completed row, unfolded at first. */
const NONE: ReadonlySet<IssueId> = new Set();

/** A set the user folds keys in and out of, starting as `initial`, and the fold of one key. */
function useToggledSet<Key>(initial: ReadonlySet<Key>): [ReadonlySet<Key>, (key: Key) => void] {
  const [keys, setKeys] = useState(initial);
  return [keys, (key) => setKeys((current) => toggled(current, key))];
}

/** The set with `key` taken out if it was in, else put in. */
function toggled<Key>(keys: ReadonlySet<Key>, key: Key): ReadonlySet<Key> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** The ids' column, as wide as the board's longest id in mono, so every row's title starts at one line (row/issue-row.css `.rmi-row-id`). */
const idColumn = (issues: readonly Row[]): CSSProperties & Record<"--rmi-id-ch", number> => ({ "--rmi-id-ch": Math.max(0, ...issues.map(({ id }) => id.length)) });
