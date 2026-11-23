// What an open round shows of its verdict, under the verifier's step (round-body.tsx): the commit
// it checked, a checkout or CI that failed it, each failing or unverifiable criterion with its
// evidence, and the passes folded; or, with no verdict returned, where its check stands.
import type { Round } from "../../../../../model/feed/round.ts";
import { checkoutText, NOT_CLEAN, NOT_CLEAN_TREE, worktreeText } from "../../../../../model/verdict/checkout.ts";
import { ciVerdictOf, failedCheckout, type CriterionResult, type ShownVerdict } from "../../../../../model/verdict/verdict.ts";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import { RESULT_WORD, ResultGlyph } from "./result-glyph.tsx";

/** What a verdict judged: an agent's done handoff, or a build parent's final check on its default branch. */
type Judged = { kind: "handoff" } | { kind: "final"; defaultBranch: string };

export function VerdictStep({ verdict, by }: { verdict: ShownVerdict; by: Round["by"] }) {
  const judged = judgedOf(by);
  if (judged === null) return null;
  switch (verdict.state) {
    case "queued":
      return <p className="rmi-verdict-meta">Waiting for a verifier</p>;
    case "running":
      return <p className="rmi-verdict-meta">Being verified</p>;
    case "returned":
      return <Returned verdict={verdict} judged={judged} />;
    case "could-not-run":
      return (
        <p className="rmi-verdict-meta" data-tone="warning">
          No verdict: {verdict.reason}
        </p>
      );
    case "superseded":
      return <p className="rmi-verdict-meta">{judged.kind === "handoff" ? "Replaced before its verdict, by a newer handoff or a new agent" : "Replaced before its verdict, by a newer final check"}</p>;
    case "waived":
      return <p className="rmi-verdict-meta">Not verified: verification was off</p>;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      verdict satisfies never;
      return null;
  }
}

/** What the round's verdict judged; null for a round this bundle doesn't know, from a newer server. */
function judgedOf(by: Round["by"]): Judged | null {
  switch (by.kind) {
    case "agent":
      return { kind: "handoff" };
    case "final":
      return { kind: "final", defaultBranch: by.defaultBranch };
    default:
      by satisfies never;
      return null;
  }
}

type ReturnedVerdict = Extract<ShownVerdict, { state: "returned" }>;

function Returned({ verdict, judged }: { verdict: ReturnedVerdict; judged: Judged }) {
  const numbered = verdict.criteria.map((check, i) => ({ ...check, number: i + 1 }));
  const failing = numbered.filter(({ result }) => result !== "pass");
  const passing = numbered.filter(({ result }) => result === "pass");
  return (
    <div className="rmi-verdict">
      <p className="rmi-verdict-meta">
        {judged.kind === "handoff" ? "Checked" : `On ${judged.defaultBranch} at`} <code>{verdict.headSha.slice(0, 7)}</code>
        {verdict.sameModel && <span data-tone="warning">{judged.kind === "handoff" ? " on the agent's own model" : " on the model of an agent whose work it checks"}</span>}
      </p>
      <CheckoutLine verdict={verdict} judged={judged} />
      <CiLine verdict={verdict} />
      {failing.length > 0 && (
        <ol className="rmi-criteria-checked" aria-label="Failing criteria">
          {failing.map((check) => (
            <Failing key={check.number} {...check} />
          ))}
        </ol>
      )}
      {passing.length > 0 && (
        <details className="rmi-passes">
          <summary>
            <DiscloseGlyph />
            {failing.length === 0 ? `All ${passing.length} passed` : `${passing.length} passed`}
          </summary>
          <ol className="rmi-criteria-checked">
            {passing.map((check) => (
              <Passed key={check.number} {...check} />
            ))}
          </ol>
        </details>
      )}
      {verdict.findings.length > 0 && (
        <section className="rmi-reported">
          <h4>Verifier's findings</h4>
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
      {judged.kind === "handoff" ? `${NOT_CLEAN}. ${checkoutText(verdict.headSha, failed)}` : `${NOT_CLEAN_TREE}. ${worktreeText(failed)}`}
    </p>
  );
}

/** Why CI hasn't been judged on the commit, when the round has something to say about it. */
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
      // why nothing: the server may be newer than this bundle for a moment after an update.
      verdict.settlement satisfies never;
      return null;
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
      // why nothing: the server may be newer than this bundle for a moment after an update.
      ci satisfies never;
      return null;
  }
}

type Criterion = { number: number; criterion: string; result: CriterionResult; evidence: string };

/** A failing or unverifiable criterion, its evidence shown: what the reader came for. */
function Failing({ number, criterion, result, evidence }: Criterion) {
  return (
    <li className="rmi-criterion">
      <p className="rmi-criterion-line">
        <ResultGlyph result={result} />
        <span className="rmi-criterion-number">{number}</span>
        <span className="rmi-criterion-text">{criterion}</span>
        <span className="rmi-result" data-result={result}>
          {RESULT_WORD[result]}
        </span>
      </p>
      <Evidence number={number} evidence={evidence} />
    </li>
  );
}

/** A passed criterion, its evidence there on demand. */
function Passed({ number, criterion, result, evidence }: Criterion) {
  return (
    <li>
      <details className="rmi-criterion">
        <summary className="rmi-criterion-line">
          <ResultGlyph result={result} />
          <span className="rmi-criterion-number">{number}</span>
          <span className="rmi-criterion-text">{criterion}</span>
          <DiscloseGlyph />
        </summary>
        <Evidence number={number} evidence={evidence} />
      </details>
    </li>
  );
}

/** why the tab stop: long output scrolls, and the keyboard scrolls only what has focus. */
const Evidence = ({ number, evidence }: { number: number; evidence: string }) => (
  <pre tabIndex={0} aria-label={`Evidence for criterion ${number}`} className="rmi-evidence">
    {evidence}
  </pre>
);

