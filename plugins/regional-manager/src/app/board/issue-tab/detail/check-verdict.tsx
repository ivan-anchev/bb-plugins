// The verdict on one handoff, or on a build parent's final check, as the user is shown it (no
// model: the board names none): how many criteria passed, the commit checked, a checkout or CI that
// failed it, then each criterion with its evidence. A failed or unverifiable criterion shows its
// evidence; a passed one keeps it folded.
import { checkoutText, worktreeText } from "../../../../model/verdict/checkout.ts";
import { allPassed, ciVerdictOf, failedCheckout, outcome, type CriterionResult, type ShownVerdict } from "../../../../model/verdict/verdict.ts";
import { ThreadLink } from "../../issue/thread-link.tsx";
import { DiscloseGlyph } from "./disclose-glyph.tsx";

/** What a verdict judged: an agent's done handoff, or a build parent's final check on its default branch. */
type Judged = { kind: "handoff" } | { kind: "final"; defaultBranch: string };

export function CheckVerdict({ verdict, judged }: { verdict: ShownVerdict; judged: Judged }) {
  switch (verdict.state) {
    case "queued":
      return <p className="rmi-verdict-line">Waiting for a verifier</p>;
    case "running":
      return (
        <p className="rmi-verdict-line">
          Being verified
          <ThreadLink name="Verifier" threadId={verdict.verifierThreadId} />
        </p>
      );
    case "returned":
      return <Returned verdict={verdict} judged={judged} />;
    case "could-not-run":
      return (
        <p className="rmi-verdict-line" data-tone="warning">
          No verdict: {verdict.reason}
          {verdict.verifierThreadId !== null && <ThreadLink name="Verifier" threadId={verdict.verifierThreadId} />}
        </p>
      );
    case "superseded":
      return <p className="rmi-verdict-line">{judged.kind === "handoff" ? "Replaced before its verdict, by a newer handoff or a new agent" : "Replaced before its verdict, by a newer final check"}</p>;
    case "waived":
      return <p className="rmi-verdict-line">Not verified: verification was off</p>;
    default:
      return verdict satisfies never;
  }
}

type ReturnedVerdict = Extract<ShownVerdict, { state: "returned" }>;

function Returned({ verdict, judged }: { verdict: ReturnedVerdict; judged: Judged }) {
  const passed = verdict.criteria.filter((check) => check.result === "pass").length;
  // why: one on its way back to the agent failed its criteria, though nobody has been told yet.
  const failed = outcome(verdict) === "fail" || !allPassed(verdict);
  return (
    <div className="rmi-verdict">
      <p className="rmi-verdict-head" data-failed={failed || undefined}>
        <ResultGlyph result={failed ? "fail" : "pass"} />
        <span>
          {passed} of {verdict.criteria.length} {verdict.criteria.length === 1 ? "criterion" : "criteria"} passed
        </span>
        <ThreadLink name="Verifier" threadId={verdict.verifierThreadId} />
      </p>
      <p className="rmi-verdict-meta">
        {judged.kind === "handoff" ? "Checked" : `On ${judged.defaultBranch} at`} <code>{verdict.headSha.slice(0, 7)}</code>
        {verdict.sameModel && <span data-tone="warning">{judged.kind === "handoff" ? " on the agent's own model" : " on the model of an agent whose work it checks"}</span>}
      </p>
      <CheckoutLine verdict={verdict} judged={judged} />
      <CiLine verdict={verdict} />
      <ol className="rmi-criteria-checked">
        {verdict.criteria.map((check, i) => (
          <Criterion key={i} number={i + 1} {...check} />
        ))}
      </ol>
      {verdict.findings.length > 0 && (
        <section className="rmi-reported">
          <h4>Findings</h4>
          <ul>
            {verdict.findings.map((finding, i) => (
              <li key={i}>{finding}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The checkout as bb's git plugin read it, when it wasn't the claimed commit on a clean tree (for a final check, when its verifier's worktree wasn't clean). */
function CheckoutLine({ verdict, judged }: { verdict: ReturnedVerdict; judged: Judged }) {
  const failed = failedCheckout(verdict);
  if (failed === null) return null;
  return (
    <p className="rmi-verdict-meta" data-tone="failed">
      {judged.kind === "handoff" ? `Not the claimed commit on a clean tree. ${checkoutText(verdict.headSha, failed)}` : `Not a clean tree. ${worktreeText(failed)}`}
    </p>
  );
}

/** Why CI hasn't been judged on the commit, when the board has something to say about it. */
function UnjudgedCiLine({ verdict }: { verdict: ReturnedVerdict }) {
  switch (verdict.settlement.kind) {
    case "waiting-for-ci":
      return <p className="rmi-verdict-meta">Waiting for CI on this commit</p>;
    case "superseded":
      return <p className="rmi-verdict-meta">Replaced before CI on this commit was judged</p>;
    case "pending":
    case "sending-back":
    case "sent-back":
    case "maybe-sent-back":
    case "checked":
      return null;
    default:
      return verdict.settlement satisfies never;
  }
}

/** What CI said about the commit, when it failed the verdict, couldn't be read, or is still to come. */
function CiLine({ verdict }: { verdict: ReturnedVerdict }) {
  const ci = ciVerdictOf(verdict);
  if (ci === null) return <UnjudgedCiLine verdict={verdict} />;
  switch (ci.kind) {
    case "none":
    case "pass":
    case "no-checks":
      return null;
    case "fail":
      return (
        <p className="rmi-verdict-meta" data-tone="failed">
          CI failed on #{ci.number}
          {ci.failedChecks.length > 0 && <>: {ci.failedChecks.join(", ")}</>}
        </p>
      );
    case "not-checked":
      return (
        <p className="rmi-verdict-meta" data-tone="warning">
          CI not checked: {ci.reason}
        </p>
      );
    default:
      return ci satisfies never;
  }
}

function Criterion({ number, criterion, result, evidence }: { number: number; criterion: string; result: CriterionResult; evidence: string }) {
  return (
    <li>
      {/* why open unless passed: a failure's evidence is what the user came for; a pass's is there on demand. */}
      <details open={result !== "pass"} className="rmi-criterion">
        <summary>
          <ResultGlyph result={result} />
          <span className="rmi-criterion-text">{criterion}</span>
          <span className="rmi-result" data-result={result}>
            {RESULT_LABEL[result]}
          </span>
          <DiscloseGlyph />
        </summary>
        {/* why the tab stop: long output scrolls, and the keyboard scrolls only what has focus. */}
        <pre tabIndex={0} aria-label={`Evidence for criterion ${number}`} className="rmi-evidence">
          {evidence}
        </pre>
      </details>
    </li>
  );
}

const RESULT_LABEL: Record<CriterionResult, string> = { pass: "Pass", fail: "Fail", unverifiable: "Unverifiable" };

function ResultGlyph({ result }: { result: CriterionResult }) {
  return (
    <svg className="rmi-result-glyph" data-result={result} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {result === "pass" && <path d="M20 6 9 17l-5-5" />}
      {result === "fail" && <path d="M18 6 6 18M6 6l12 12" />}
      {result === "unverifiable" && <path d="M12 8v4M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />}
    </svg>
  );
}
