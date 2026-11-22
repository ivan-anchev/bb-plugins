// An issue's done-criteria as a criteria × rounds grid (round.ts criteriaGrid): each criterion's
// number and words, then a cell per round with a verdict, its result by shape and colour. A cell is
// a button: pressed, the row opens under it to that round's evidence for the criterion, read with
// the round's body. A research issue's questions list alone: nothing judges them.
import { useId, useState } from "react";
import { criteriaGrid, type GridRow, type Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { CriterionResult } from "../../../../../model/verdict/verdict.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
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
        {verified && <span className="rmi-section-sub">{subtitleOf(rows, judged)}</span>}
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
                    <button
                      key={cell.round}
                      type="button"
                      className="rmi-grid-cell"
                      data-result={cell.result ?? "none"}
                      aria-expanded={opened?.row === i && opened.round === cell.round}
                      aria-label={`Round ${cell.round}: ${cell.result === null ? "not judged" : RESULT_WORD[cell.result]}`}
                      onClick={() => toggle({ row: i, round: cell.round })}
                    >
                      <span aria-hidden className="rmi-grid-swatch" />
                    </button>
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

/** How many rounds judged the criteria and the latest's score, or how many criteria wait for one. */
function subtitleOf(rows: readonly GridRow[], judged: number): string {
  if (rows.length === 0) return "";
  if (judged === 0) return `${rows.length} · no verdict yet`;
  const latest = rows.map(({ cells }) => cells.at(-1)?.result ?? null);
  const passed = latest.filter((result) => result === "pass").length;
  return `${judged === 1 ? "1 round" : `${judged} rounds`} · latest ${passed} of ${latest.filter((result) => result !== null).length}`;
}

const RESULT_WORD: Record<CriterionResult, string> = { pass: "passed", fail: "failed", unverifiable: "couldn't check" };
