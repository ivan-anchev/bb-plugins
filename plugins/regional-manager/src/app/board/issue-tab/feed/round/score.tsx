// What a round says of its check in a word or two (round.ts scoreOf): ✓ 6 of 6, ✗ 3 of 6, ✗ CI failed, ✗ Must-fix upheld,
// Reviewing…, Verifying…, Waiting for CI…, or why it has none; a blocked or abandoned handoff's round says so. Beside
// it in the round's head only, the failure that put the cap question to the user says "3rd failed verification: asked you".
import { createContext, useContext } from "react";
import type { DecisionId } from "../../../../../model/decision.ts";
import { scoreOf, type Round } from "../../../../../model/feed/round.ts";
import { ordinal } from "../../../../../model/verdict/rounds/cap.ts";
import { NOT_CLEAN, NOT_CLEAN_TREE } from "../../../../../model/verdict/checkout.ts";
import { ResultGlyph } from "./result-glyph.tsx";

export function Score({ round }: { round: Round }) {
  const score = scoreOf(round);
  if (score === null) return <HandoffEnd round={round} />;
  switch (score.kind) {
    case "judged":
      return (
        <span className="rmi-score" data-result="pass">
          <ResultGlyph result="pass" />
          <span className="sr-only">Passed: </span>
          {score.passed} of {score.of}
        </span>
      );
    case "failed":
      return (
        <span className="rmi-score" data-result="fail">
          <ResultGlyph result="fail" />
          {score.by === "criteria" ? (
            <>
              <span className="sr-only">Failed: </span>
              {score.passed} of {score.of}
            </>
          ) : (
            <span className="rmi-score-text" title={failedByText(score.by, round.by)}>
              {failedByText(score.by, round.by)}
            </span>
          )}
        </span>
      );
    case "pending":
      return <span className="rmi-score">{PENDING[score.stage]}</span>;
    case "unjudged":
      return (
        <span className="rmi-score" data-tone={score.outcome === "could-not-run" ? "warning" : undefined}>
          {UNJUDGED[score.outcome]}
        </span>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      score satisfies never;
      return null;
  }
}

/**
 * The count of failed verifications each cap question of the feed was asked at, by its id, from
 * the question itself among the feed's decisions (feed.tsx): what a round's note reads its count from.
 */
export const CapCounts = createContext<ReadonlyMap<DecisionId, number>>(new Map());

/**
 * On the one round whose failure put the cap question to the user (round.ts), what it did, in its
 * head beside its score (round-card.tsx): "3rd failed verification: asked you". why not in Score:
 * the grid's latest and the verifier's step show the score too, and the count is the round's alone.
 */
export function AskedNote({ asked }: { asked: DecisionId | null }) {
  const counts = useContext(CapCounts);
  if (asked === null) return null;
  // why a neutral fallback: the question comes in the same feed read as its round, but a map can't promise the type checker its key.
  const failed = counts.get(asked);
  const text = failed === undefined ? "Failed verification: asked you" : `${ordinal(failed)} failed verification: asked you`;
  return (
    <span className="rmi-score-asked" title={`${text} on the board (${asked})`}>
      <span aria-hidden="true">· </span>
      {text}
    </span>
  );
}

/** A round nothing checks: how its handoff ended, when not done; nothing for a final check, or a kind or status this bundle doesn't know. */
function HandoffEnd({ round: { by } }: { round: Round }) {
  switch (by.kind) {
    case "final":
      return null;
    case "agent":
      return <HandoffStatus status={by.status} />;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      by satisfies never;
      return null;
  }
}

function HandoffStatus({ status }: { status: Extract<Round["by"], { kind: "agent" }>["status"] }) {
  switch (status) {
    case "done":
      return null;
    case "blocked":
      return (
        <span className="rmi-score" data-tone="warning">
          Blocked
        </span>
      );
    case "gave-up":
      return (
        <span className="rmi-score" data-tone="failed">
          Gave up
        </span>
      );
    default:
      status satisfies never;
      return null;
  }
}

/** What failed a round whose criteria all passed, leading its line: the reason, never "n of n". why by the round: a final check claims no commit, so its checkout fails only by a dirty tree. */
function failedByText(by: "checkout" | "must-fix" | "defect" | "ci", round: Round["by"]): string {
  switch (by) {
    case "ci":
      return "CI failed";
    case "must-fix":
      return "Must-fix upheld";
    case "defect":
      return "Blocking defect found";
    case "checkout":
      return round.kind === "final" ? NOT_CLEAN_TREE : NOT_CLEAN;
    default:
      return by satisfies never;
  }
}

const PENDING = { reviewing: "Reviewing…", verifying: "Verifying…", ci: "Waiting for CI…" } as const;

const UNJUDGED = { "could-not-run": "Couldn't verify", superseded: "Replaced", unverified: "Not verified" } as const;
