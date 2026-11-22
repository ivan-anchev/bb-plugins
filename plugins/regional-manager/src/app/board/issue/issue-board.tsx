import "./issue-board.css";
import { useId, useState, type ReactNode } from "react";
import type { IssueRow as Row } from "../../../contract.ts";
import { boardGroups, LANE_LABELS, type BoardItem, type Lane } from "../../../model/board/board-groups.ts";
import type { Decision, OpenDecision } from "../../../model/decision.ts";
import type { IssueId } from "../../../model/issue/issue.ts";
import { useFocusKeptAcrossGroups } from "../../ui/focus-hand-off.ts";
import { IssueRow } from "./issue-row.tsx";
import { LaneHeader } from "../../ui/lane-header/lane-header.tsx";
import { NeedsYouGlyph, StatusGlyph } from "./status-glyph.tsx";

type IssueBoardProps = {
  decisions: readonly Decision[];
  issues: readonly Row[];
  /** A decision's row, while it waits for the user's answer. */
  decisionRow(decision: OpenDecision): ReactNode;
};

export function IssueBoard({ decisions, issues, decisionRow }: IssueBoardProps) {
  const ids = useId();
  const [folded, setFolded] = useState(FOLDED_AT_FIRST);
  const groups = boardGroups(decisions, issues);
  const laneOfKey = (key: string): Lane | null => groups.find(({ rows }) => rows.some((entry) => livesIn(entry).includes(key)))?.lane ?? null;
  const focus = useFocusKeptAcrossGroups(laneOfKey);

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

const idOf = (entry: BoardItem<Row>): string => (entry.kind === "decision" ? entry.decision.id : entry.issue.id);

const rowKeyOf = (entry: BoardItem<Row>): string => (entry.kind === "flagged-sub-issue" ? `${entry.issue.id} under Needs you` : idOf(entry));

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

const FOLDED_AT_FIRST: ReadonlySet<Lane> = new Set(["backlog", "done", "canceled"]);

function toggled<Key>(keys: ReadonlySet<Key>, key: Key): ReadonlySet<Key> {
  const next = new Set(keys);
  if (!next.delete(key)) next.add(key);
  return next;
}

const laneGlyph = (lane: Lane): ReactNode => (lane === "needs-you" ? <NeedsYouGlyph /> : <StatusGlyph status={lane} still />);
