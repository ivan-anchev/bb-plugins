// What a round says of its check in a word or two (round.ts scoreOf): ✓ 6 of 6, ✗ 3 of 6,
// Reviewing…, Verifying…, or why it has none; a blocked or abandoned handoff's round says so.
import { scoreOf, type Round } from "../../../../../model/feed/round.ts";
import { ResultGlyph } from "./result-glyph.tsx";

export function Score({ round }: { round: Round }) {
  const score = scoreOf(round);
  if (score === null) return <HandoffEnd round={round} />;
  switch (score.kind) {
    case "judged":
      return (
        <span className="rmi-score" data-result={score.failed ? "fail" : "pass"}>
          <ResultGlyph result={score.failed ? "fail" : "pass"} />
          <span className="sr-only">{score.failed ? "Failed: " : "Passed: "}</span>
          {score.passed} of {score.of}
        </span>
      );
    case "pending":
      return <span className="rmi-score">{score.stage === "reviewing" ? "Reviewing…" : "Verifying…"}</span>;
    case "unjudged":
      return (
        <span className="rmi-score" data-tone={score.outcome === "could-not-run" ? "warning" : undefined}>
          {UNJUDGED[score.outcome]}
        </span>
      );
    default:
      return score satisfies never;
  }
}

/** A round nothing checks: how its handoff ended, when not done. */
function HandoffEnd({ round: { by } }: { round: Round }) {
  if (by.kind !== "agent" || by.status === "done") return null;
  return (
    <span className="rmi-score" data-tone={by.status === "blocked" ? "warning" : "failed"}>
      {by.status === "blocked" ? "Blocked" : "Gave up"}
    </span>
  );
}

const UNJUDGED = { "could-not-run": "Couldn't verify", superseded: "Replaced", unverified: "Not verified" } as const;
