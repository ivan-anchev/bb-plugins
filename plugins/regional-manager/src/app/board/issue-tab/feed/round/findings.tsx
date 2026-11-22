// The reviewer's findings in an open round: each its severity, its place in the diff and its claim,
// then the verifier's triage, Confirmed or Rejected with why; a rejected claim struck through.
import type { RoundBody } from "../../../../../model/feed/round.ts";

type Finding = RoundBody["findings"][number];

export function Findings({ findings }: { findings: readonly Finding[] }) {
  return (
    <ul className="rmi-findings" aria-label="Findings">
      {findings.map((finding, i) => (
        <li key={i} className="rmi-finding" data-triage={finding.triage?.result}>
          <p className="rmi-finding-top">
            <span className="rmi-severity" data-severity={finding.severity}>
              {SEVERITY[finding.severity]}
            </span>
            {/* why right to left with the path in a bdi: a long path is cut at its start, so its file and line stay in view, and still reads left to right. */}
            <span className="rmi-finding-place" title={placeOf(finding)}>
              <bdi>{placeOf(finding)}</bdi>
            </span>
          </p>
          <p className="rmi-finding-claim">
            {finding.triage?.result === "rejected" ? <s>{finding.claim}</s> : finding.claim}
          </p>
          {finding.triage !== null && (
            <p className="rmi-triage" data-triage={finding.triage.result}>
              <b>{finding.triage.result === "confirmed" ? "Confirmed" : "Rejected"}</b> {finding.triage.reason}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

const placeOf = ({ file, line }: Finding): string => (line === null ? file : `${file}:${line}`);

const SEVERITY: Record<Finding["severity"], string> = { "must-fix": "Must fix", "should-fix": "Should fix", nit: "Nit" };
