// The reviewer's findings in an open round: each its place in the diff, its severity and its claim,
// then the verifier's triage, Confirmed or Rejected with why; a rejected claim struck through. And
// how many there were, and how many the verifier confirmed, as the round's rail and fold count them.
import type { Round, RoundBody } from "../../../../../model/feed/round.ts";

type Finding = RoundBody["findings"][number];
type Reported = Extract<Round["review"], { state: "reported" }>;

export function Findings({ findings }: { findings: readonly Finding[] }) {
  return (
    <ul className="rmi-findings" aria-label="Findings">
      {findings.map((finding, i) => (
        <li key={i} className="rmi-finding" data-triage={finding.triage?.result}>
          <p className="rmi-finding-line">
            <Place {...finding} /> <span className="rmi-severity" data-severity={finding.severity}>({finding.severity}):</span>{" "}
            <span className="rmi-finding-claim">{isRejected(finding) ? <s>{finding.claim}</s> : finding.claim}</span>
          </p>
          {finding.triage !== null && <Triage {...finding.triage} />}
        </li>
      ))}
    </ul>
  );
}

/** How many findings the review reported and, once the verdict triaged them, how many it confirmed: "2 findings, 1 confirmed". */
export function findingsText({ findings, confirmed }: Reported): string {
  const found = findings === 0 ? "No findings" : `${findings} ${findings === 1 ? "finding" : "findings"}`;
  return confirmed === null || findings === 0 ? found : `${found}, ${confirmed} confirmed`;
}

/**
 * Where in the diff a finding is, its path exactly as the reviewer wrote it, whole on hover. why
 * right to left around a left-to-right place: a long path is cut at its start, so its file and line
 * stay in view. why the path in an isolate of its own: a bidi mark or an unclosed override inside it
 * ends there, so it can't reorder the line after it. why white-space pre: a leading or trailing space
 * is part of the path, and shows.
 */
function Place({ file, line }: Finding) {
  const place = line === null ? file : `${file}:${line}`;
  return (
    <span className="rmi-finding-place" title={place}>
      <bdi dir="ltr">
        <bdi dir="ltr" className="rmi-finding-file">
          {file}
        </bdi>
        {line !== null && `:${line}`}
      </bdi>
    </span>
  );
}

/** The verifier's word on a finding and why; nothing for a result this bundle doesn't know, from a newer server. */
function Triage({ result, reason }: NonNullable<Finding["triage"]>) {
  switch (result) {
    case "confirmed":
    case "rejected":
      return (
        <p className="rmi-triage" data-triage={result}>
          <b>{result === "confirmed" ? "Confirmed" : "Rejected"}</b> {reason}
        </p>
      );
    default:
      result satisfies never;
      return null;
  }
}

const isRejected = ({ triage }: Finding): boolean => triage?.result === "rejected";
