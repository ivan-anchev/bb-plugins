// The board's lanes: Needs you on top, then a lane per status (lanes.ts), each under a header that
// folds it. Backlog, Done and Canceled start folded. A row opens its detail in place under it; the
// detail is drawn only while it is open, so the caller reads it only then. Decisions keep their own
// row, the caller's. Which lanes are folded and which rows are open outlive a row moving lanes.
import "./issue-board.css";
import { useId, useState, type ReactNode, type RefCallback } from "react";
import type { Decision } from "../../../model/decision.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { STATUS_LABELS } from "../../../model/issue/status.ts";
import { useFocusKeptByKey } from "../../ui/focus-hand-off.ts";
import type { BoardIssue } from "./board-issue.ts";
import { IssueRow } from "./issue-row.tsx";
import { LaneHeader } from "./lane-header.tsx";
import { LANES, lanesOf, type LaneItem, type LaneKey } from "./lanes.ts";
import { NeedsYouGlyph, StatusGlyph } from "./status-glyph.tsx";

type IssueBoardProps = {
  decisions: readonly Decision[];
  issues: readonly BoardIssue[];
  /** A decision's row; `ref` keeps focus in it as it moves from Needs you to Done. */
  decisionRow(decision: Decision, ref: RefCallback<HTMLElement>): ReactNode;
  /** An open issue's detail, under its row. */
  detailOf(issue: BoardIssue): ReactNode;
};

export function IssueBoard({ decisions, issues, decisionRow, detailOf }: IssueBoardProps) {
  // why: each header labels its lane by id, and a page may show more than one board.
  const ids = useId();
  const keepFocus = useFocusKeptByKey();
  const [folded, toggleFolded] = useToggles<LaneKey>(FOLDED_AT_FIRST);
  const [opened, toggleOpened] = useToggles<IssueId>(NONE_OPEN);

  function item(entry: LaneItem): ReactNode {
    switch (entry.kind) {
      case "decision":
        return decisionRow(entry.decision, keepFocus(entry.decision.id));
      case "issue":
        return <IssueItem issue={entry.issue} depth={entry.depth} open={opened.has(entry.issue.id)} onToggle={() => toggleOpened(entry.issue.id)} rowRef={keepFocus(entry.issue.id)} detailOf={detailOf} />;
      default:
        return entry satisfies never;
    }
  }

  return (
    <div className="rmi-board">
      {lanesOf(decisions, issues).map((lane) => {
        const open = !folded.has(lane.key);
        const headerId = `${ids}-${lane.key}`;
        return (
          <section key={lane.key} aria-labelledby={headerId} className="rmi-lane-section">
            <LaneHeader id={headerId} listId={`${headerId}-list`} glyph={laneGlyph(lane.key)} name={laneName(lane.key)} count={lane.count} open={open} onToggle={() => toggleFolded(lane.key)} />
            {open && (
              <ul id={`${headerId}-list`} className="rmi-list">
                {lane.items.map((entry) => (
                  <li key={itemKey(entry)}>{item(entry)}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

type IssueItemProps = { issue: BoardIssue; depth: 0 | 1; open: boolean; onToggle(): void; rowRef: RefCallback<HTMLElement>; detailOf: IssueBoardProps["detailOf"] };

/** An issue's row, and its detail under it while open. */
function IssueItem({ issue, depth, open, onToggle, rowRef, detailOf }: IssueItemProps) {
  const detailId = useId();
  return (
    <>
      <IssueRow ref={rowRef} issue={issue} depth={depth} open={open} detailId={detailId} onToggle={onToggle} />
      {open && (
        <div id={detailId} role="region" aria-label={`${issue.id}: ${issue.title}`} className="rmi-detail" data-depth={depth || undefined}>
          {detailOf(issue)}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ layer 2

const FOLDED_AT_FIRST: ReadonlySet<LaneKey> = new Set(LANES.filter((lane) => lane.folded).map((lane) => lane.status));
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

const laneName = (key: LaneKey): string => (key === "needs-you" ? "Needs you" : STATUS_LABELS[key]);

/** A lane's glyph names its status, so it stands still; Needs you has its own. */
const laneGlyph = (key: LaneKey): ReactNode => (key === "needs-you" ? <NeedsYouGlyph /> : <StatusGlyph status={key} still />);

/** why the depth: a sub-issue waiting on the user is in Needs you twice, flat and under its waiting parent. */
const itemKey = (entry: LaneItem): string => (entry.kind === "decision" ? entry.decision.id : `${entry.depth}-${entry.issue.id}`);
