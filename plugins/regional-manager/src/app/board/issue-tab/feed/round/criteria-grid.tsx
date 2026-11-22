// An issue's done-criteria as a criteria × rounds grid (round.ts criteriaGrid): each criterion's
// number and words, then a cell per round with a verdict, its result by glyph and colour. A cell is
// a button, named by a tooltip on hover and focus; pressed, the row opens under it to that round's
// evidence for the criterion, read with the round's body. A research issue's questions list alone:
// nothing judges them.
import { useId, useState } from "react";
import { criteriaGrid, type Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { CriterionResult } from "../../../../../model/verdict/verdict.ts";
import { useEscapeToClose } from "../../../../ui/hold-escape.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
import { RESULT_WORD, ResultGlyph } from "./result-glyph.tsx";
import { Score } from "./score.tsx";
import { useRoundBody } from "./round-body.tsx";

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
        {verified && rows.length > 0 && <GridSubtitle criteria={rows.length} rounds={rounds} />}
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
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shown = (hovered || focused) && !dismissed;
  useEscapeToClose(shown, () => setDismissed(true));
  const named = `Round ${round}: ${result === null ? "not judged" : RESULT_WORD[result]}`;
  return (
    <span
      className="rmi-grid-cell-slot"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="rmi-grid-cell"
        data-result={result ?? "none"}
        aria-expanded={expanded}
        aria-label={named}
        aria-describedby={shown ? tipId : undefined}
        onClick={onPress}
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
      >
        {result === null ? <span aria-hidden className="rmi-grid-none" /> : <ResultGlyph result={result} />}
      </button>
      {shown && (
        <span id={tipId} role="tooltip" className="rmi-grid-tip">
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
      {body !== undefined && judged === null && <p className="rmi-verdict-meta">Round {round.number} judged no criterion here.</p>}
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

/**
 * How many rounds judged the criteria and the latest's own score, as its line says it (score.tsx),
 * or how many criteria wait for a verdict. why its score, not a count of the cells: a round all of
 * whose criteria passed may have failed by CI or its checkout, or not be settled yet.
 */
function GridSubtitle({ criteria, rounds }: { criteria: number; rounds: readonly Round[] }) {
  const judged = rounds.filter(({ verdict }) => verdict !== null && verdict.results.length > 0);
  const latest = judged.at(-1);
  if (latest === undefined) return <span className="rmi-section-sub">{criteria} · no verdict yet</span>;
  return (
    <span className="rmi-section-sub">
      {judged.length === 1 ? "1 round" : `${judged.length} rounds`} · latest <Score round={latest} />
    </span>
  );
}

