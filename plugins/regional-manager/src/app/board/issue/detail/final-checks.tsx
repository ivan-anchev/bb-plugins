// A build parent's final checks, oldest first, the latest open: where each stands on the default
// branch, when it was made, and its verdict, read as a handoff's is.
import type { ShownFinalCheck } from "../../../../contract.ts";
import { outcome } from "../../../../model/verdict/verdict.ts";
import { shortTime } from "../../../ui/time.ts";
import { CheckVerdict } from "./check-verdict.tsx";
import { DiscloseGlyph } from "./disclose-glyph.tsx";

export function FinalChecks({ checks }: { checks: readonly ShownFinalCheck[] }) {
  return (
    <ol className="rmi-final-checks">
      {checks.map((check, i) => (
        <li key={`${check.at}-${i}`}>
          <details open={i === checks.length - 1} className="rmi-handoff">
            <summary>
              <DiscloseGlyph />
              <FinalCheckResult check={check} />
              <span className="rmi-handoff-summary">on {check.defaultBranch}</span>
              <time dateTime={new Date(check.at).toISOString()}>{shortTime(check.at)}</time>
            </summary>
            <div className="rmi-handoff-body">
              <CheckVerdict verdict={check.verdict} judged={{ kind: "final", defaultBranch: check.defaultBranch }} />
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

/** Where the check stands, in a word, in its tone. */
function FinalCheckResult({ check: { verdict } }: { check: ShownFinalCheck }) {
  const result = outcome(verdict);
  switch (result) {
    case "pending":
    case "waiting-for-ci":
      return <span className="rmi-handoff-status">Running</span>;
    case "pass":
      return <span className="rmi-handoff-status">Passed</span>;
    case "fail":
      return (
        <span className="rmi-handoff-status" data-tone="failed">
          Failed
        </span>
      );
    case "could-not-run":
      return (
        <span className="rmi-handoff-status" data-tone="warning">
          Couldn't run
        </span>
      );
    case "superseded":
      return <span className="rmi-handoff-status">Replaced</span>;
    case "unverified":
      return <span className="rmi-handoff-status">Not run</span>;
    default:
      return result satisfies never;
  }
}
