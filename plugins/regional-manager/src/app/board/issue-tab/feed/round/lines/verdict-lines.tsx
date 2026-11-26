// What failed an open round, a line each (round-body.tsx): its checkout, when it wasn't the claimed
// commit on a clean tree; each criterion that failed or couldn't be checked, as its number and what
// the run showed, opening to the criterion and its evidence; each blocking defect the verifier found
// (finding-lines.tsx); CI that failed or wasn't checked; and a verifier that ran on the model of an
// agent whose work it checks. Or, with no verdict returned, why none will come. why no passes: the
// Done when grid marks each criterion's result in each round.
import type { ReactElement } from "react";
import type { Round } from "../../../../../../model/feed/round.ts";
import { checkoutText, NOT_CLEAN, NOT_CLEAN_TREE, worktreeText } from "../../../../../../model/verdict/checkout.ts";
import { prRef } from "../../../../../../model/verdict/pr.ts";
import { ciVerdictOf, failedCheckout, type ShownVerdict } from "../../../../../../model/verdict/verdict.ts";
import type { HoverCards } from "../../../../issue/hover-card/use-hover-card.ts";
import { RESULT_WORD, ResultGlyph } from "../result-glyph.tsx";
import { DefectLine } from "./finding-lines.tsx";
import { FoldLine, NoteLine } from "./fold-line.tsx";

/** What a verdict judged: an agent's done handoff, or a build parent's final check on its default branch. */
type Judged = { kind: "handoff" } | { kind: "final"; defaultBranch: string };

export function VerdictLines({ verdict, by, cards }: { verdict: ShownVerdict; by: Round["by"]; cards: HoverCards }) {
  const judged = judgedOf(by);
  if (judged === null) return null;
  switch (verdict.state) {
    case "returned":
      return <Returned verdict={verdict} judged={judged} cards={cards} />;
    case "could-not-run":
      return (
        <ul className="rmi-lines" aria-label="What failed">
          <NoteLine tone="warning" headline="No verdict" detail={<p className="rmi-fold-claim">{verdict.reason}</p>} />
        </ul>
      );
    case "superseded":
      return (
        <ul className="rmi-lines" aria-label="What failed">
          <NoteLine tone={null} headline="Replaced before its verdict" detail={<p className="rmi-fold-claim">{judged.kind === "handoff" ? "By a newer handoff or a new agent." : "By a newer final check."}</p>} />
        </ul>
      );
    // why nothing: the round's score says it waits for a verifier, is being verified, or wasn't.
    case "queued":
    case "running":
    case "waived":
      return null;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      verdict satisfies never;
      return null;
  }
}

// ------------------------------------------------------------------ layer 2

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

function Returned({ verdict, judged, cards }: { verdict: ReturnedVerdict; judged: Judged; cards: HoverCards }) {
  const failing = verdict.criteria.flatMap((check, i) => (check.result === "pass" ? [] : [{ ...check, number: i + 1 }]));
  const checkout = checkoutLine(verdict, judged);
  const ci = ciLine(verdict);
  if (checkout === null && failing.length === 0 && verdict.blocking.length === 0 && ci === null && !verdict.sameModel) return null;
  return (
    <ul className="rmi-lines" aria-label="What failed">
      {checkout}
      {failing.map((check) => (
        <CriterionLine key={check.number} {...check} />
      ))}
      {verdict.blocking.map((defect, i) => (
        <DefectLine key={i} cardKey={`d${i}`} defect={defect} cards={cards} />
      ))}
      {ci}
      {verdict.sameModel && <NoteLine tone="warning" headline={judged.kind === "handoff" ? "Verified on the agent's own model" : "Verified on the model of an agent whose work it checks"} detail={null} />}
    </ul>
  );
}

type Failing = ReturnedVerdict["criteria"][number] & { number: number };

/** A criterion that failed or couldn't be checked: its glyph, number and what the run showed; pressed, the criterion and its evidence. */
function CriterionLine({ number, criterion, result, shows, evidence }: Failing) {
  return (
    <FoldLine
      line={
        <>
          <ResultGlyph result={result} />
          <span className="sr-only">Criterion {number} {RESULT_WORD[result]}: </span>
          <span className="rmi-line-number" aria-hidden>
            {number}
          </span>
          <span className="rmi-line-title">{shows}</span>
        </>
      }
      detail={
        <>
          <p className="rmi-fold-claim">{criterion}</p>
          <pre tabIndex={0} aria-label={`Evidence for criterion ${number}`} className="rmi-evidence">
            {evidence}
          </pre>
        </>
      }
    />
  );
}

/** The checkout as bb's git plugin read it, when it wasn't the claimed commit on a clean tree (for a final check, when its verifier's worktree wasn't clean): what it read, open on press. */
function checkoutLine(verdict: ReturnedVerdict, judged: Judged): ReactElement | null {
  const failed = failedCheckout(verdict);
  if (failed === null) return null;
  const said = judged.kind === "handoff" ? { headline: NOT_CLEAN, detail: checkoutText(verdict.headSha, failed) } : { headline: NOT_CLEAN_TREE, detail: worktreeText(failed) };
  return <NoteLine tone="failed" headline={said.headline} detail={<p className="rmi-fold-claim">{said.detail}</p>} />;
}

/** What CI said about the commit, when it failed the verdict, couldn't be read, or is still to come: the failed checks, or why it wasn't checked, open on press. */
function ciLine(verdict: ReturnedVerdict): ReactElement | null {
  const ci = ciVerdictOf(verdict);
  if (ci === null) return unjudgedCiLine(verdict);
  switch (ci.kind) {
    case "none":
    case "pass":
    case "no-checks":
      return null;
    case "fail":
      return <NoteLine tone="failed" headline={`CI failed on ${prRef(ci)}`} detail={ci.failedChecks.length === 0 ? null : <FailedChecks checks={ci.failedChecks} />} />;
    case "not-checked":
      return <NoteLine tone="warning" headline="CI not checked" detail={<p className="rmi-fold-claim">{ci.reason}</p>} />;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      ci satisfies never;
      return null;
  }
}

const FailedChecks = ({ checks }: { checks: readonly string[] }) => (
  <ul className="rmi-fold-checks" aria-label="Failed checks">
    {checks.map((check) => (
      <li key={check}>{check}</li>
    ))}
  </ul>
);

/** Why CI hasn't been judged on the commit, when the round has something to say about it. */
function unjudgedCiLine(verdict: ReturnedVerdict): ReactElement | null {
  switch (verdict.settlement.kind) {
    case "waiting-for-ci":
      return <NoteLine tone={null} headline="Waiting for CI on this commit" detail={null} />;
    case "superseded":
      return <NoteLine tone={null} headline="Replaced before CI on this commit was judged" detail={null} />;
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
