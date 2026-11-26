// An issue's done-criteria as a criteria × rounds grid (round.ts criteriaGrid): each criterion's
// number and words, then a cell per round with a verdict, its result by glyph and colour, and beside
// the heading the latest round's marks counted, as a diff counts its lines. A cell is a button, named
// by a tooltip on hover and focus; pressed, the row opens under it to that round's evidence for the
// criterion, read with the round's body. A research issue's questions list alone: nothing judges them.
import { useId, useState } from "react";
import { criteriaGrid, type GridRow, type Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { CriterionResult } from "../../../../../model/verdict/verdict.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
import { RESULT_WORD, ResultGlyph } from "./result-glyph.tsx";
import { useRoundBody } from "./round-body.tsx";
import { useTip } from "./tip.ts";

/** `verified`: the issue is of a kind a verifier judges; else its criteria are questions its report answers. */
type CriteriaGridProps = { coordinatorId: CoordinatorId; issueId: IssueId; verified: boolean; criteria: readonly string[]; rounds: readonly Round[] };

/** The cell the reader opened: its criterion's place, and its round's number. */
type Opened = { row: number; round: number };

export function CriteriaGrid({ coordinatorId, issueId, verified, criteria, rounds }: CriteriaGridProps) {
  const titleId = useId();
  const [opened, setOpened] = useState<Opened | null>(null);
  const rows = criteriaGrid(criteria, rounds);
  const judged = rows[0]?.cells.length ?? 0;
  const toggle = (cell: Opened) => setOpened((now) => (now?.row === cell.row && now.round === cell.round ? null : cell));
  const openRound = opened === null ? null : (rounds.find(({ number }) => number === opened.round) ?? null);
  return (
    <section className="rmi-part" aria-labelledby={titleId}>
      <div className="rmi-section-head">
        <h3 id={titleId} className="rmi-part-title">
          {verified ? "Done when" : "Questions"}
        </h3>
        {verified && <Tally rows={rows} />}
      </div>
      <ol className="rmi-grid">
        {rows.map((row, i) => (
          <li key={i}>
            <div className="rmi-grid-row">
              <span className="rmi-grid-number">{i + 1}</span>
              <span className="rmi-grid-text">{row.criterion}</span>
              {judged > 0 && (
                <span className="rmi-grid-cells" role="group" aria-label={`Criterion ${i + 1} by round`}>
                  {row.cells.map((cell) => (
                    <GridCell key={cell.round} {...cell} expanded={opened?.row === i && opened.round === cell.round} onPress={() => toggle({ row: i, round: cell.round })} />
                  ))}
                </span>
              )}
            </div>
            {opened?.row === i && openRound !== null && <CellEvidence coordinatorId={coordinatorId} issueId={issueId} round={openRound} row={i} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

type GridCellProps = { round: number; result: CriterionResult | null; expanded: boolean; onPress(): void };

/**
 * A round's result on a criterion: its glyph, a check, a cross or a warning sign, so shape tells
 * results apart and not colour alone; pressed, it opens the evidence. Hovered or focused, a tooltip
 * names it; it stays while the pointer is on the cell or the tooltip, or focus is on the cell, and
 * Escape closes it wherever focus is.
 */
function GridCell({ round, result, expanded, onPress }: GridCellProps) {
  const tip = useTip();
  const named = `Round ${round}: ${result === null ? "not judged" : RESULT_WORD[result]}`;
  return (
    <span className="rmi-grid-cell-slot" {...tip.slot}>
      <button type="button" className="rmi-grid-cell" data-result={result ?? "none"} aria-expanded={expanded} aria-label={named} aria-describedby={tip.shown ? tip.id : undefined} onClick={onPress} {...tip.trigger}>
        {result === null ? <span aria-hidden className="rmi-grid-none" /> : <ResultGlyph result={result} />}
      </button>
      {tip.shown && (
        <span id={tip.id} role="tooltip" className="rmi-tip">
          {named}. {expanded ? "Press to close its evidence." : "Press for its evidence."}
        </span>
      )}
    </span>
  );
}

/** One round's judgement of one criterion: the words it judged and its evidence, from the round's body. */
function CellEvidence({ coordinatorId, issueId, round, row }: { coordinatorId: CoordinatorId; issueId: IssueId; round: Round; row: number }) {
  const { body, error, retry } = useRoundBody({ coordinatorId, issueId }, round.key);
  const verdict = body?.verdict ?? null;
  const judged = verdict?.state === "returned" ? (verdict.criteria[row] ?? null) : null;
  return (
    <div className="rmi-grid-evidence" role="region" aria-label={`Round ${round.number}, criterion ${row + 1}`}>
      {error !== null && <ReadFailure onRetry={retry}>Could not read round {round.number}: {error.message}</ReadFailure>}
      {body === undefined && error === null && <p className="rmi-verdict-meta">Loading round {round.number}…</p>}
      {body === null && <p className="rmi-verdict-meta">Round {round.number} is no longer on record.</p>}
      {body != null && judged === null && <p className="rmi-verdict-meta">Round {round.number} judged no criterion here.</p>}
      {judged !== null && (
        <>
          <p className="rmi-verdict-meta">
            Round {round.number}: <span data-result={judged.result}>{RESULT_WORD[judged.result]}</span>, judged as “{judged.criterion}”
          </p>
          {/* why the tab stop: long output scrolls, and the keyboard scrolls only what has focus. */}
          <pre tabIndex={0} aria-label={`Evidence for criterion ${row + 1} in round ${round.number}`} className="rmi-evidence">
            {judged.evidence}
          </pre>
        </>
      )}
    </div>
  );
}

/** The criteria's results in the latest round that judged them: as a diff stat, ✓ passed and ✗ failed, and ⚠ couldn't check while any did; nothing before a verdict. */
function Tally({ rows }: { rows: readonly GridRow[] }) {
  const latest = rows.flatMap(({ cells }) => cells.at(-1) ?? []);
  const judged = latest.flatMap(({ result }) => result ?? []);
  const round = latest[0]?.round;
  if (round === undefined) return null;
  const count = (result: CriterionResult) => judged.filter((one) => one === result).length;
  const counts = TALLIED.map((result) => ({ result, n: count(result) })).filter(({ result, n }) => n > 0 || result !== "unverifiable");
  return (
    <span className="rmi-tally">
      {counts.map(({ result, n }) => (
        <span key={result} data-result={result} aria-hidden>
          <ResultGlyph result={result} />
          {n}
        </span>
      ))}
      <span className="sr-only">
        Round {round}: {counts.map(({ result, n }) => `${n} ${RESULT_WORD[result]}`).join(", ")}
      </span>
    </span>
  );
}

const TALLIED: readonly CriterionResult[] = ["pass", "fail", "unverifiable"];
