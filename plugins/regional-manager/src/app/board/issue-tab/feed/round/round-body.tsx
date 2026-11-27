// An open round as a short list: what was handed off, in full; a line per finding (lines/
// finding-lines.tsx); a line per thing that failed it (lines/verdict-lines.tsx); what became of it;
// and its report, folded. Each line opens on press to its detail, and a finding's shows its card on
// hover and focus. The summary and the outcome come from the feed's read; the rest is the round's
// body, read with the keyed roundBodies query only while the round is open, so a folded round costs
// nothing. why no step captions, counts or passes: the lines are the review and the verdict, the
// head's score says how it ended, and the Done when grid marks each criterion.
import { experimental_useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { useId, type ReactNode } from "react";
import { coordinatorContract as contract, roundBodyKey } from "../../../../../contract.ts";
import type { HandoffBody } from "../../../../../model/agent/handoff.ts";
import type { DecisionId } from "../../../../../model/decision.ts";
import type { Round, RoundBody as Body, RoundKey, Step as StepAt } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { Outcome } from "../../../../../model/verdict/verdict.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
import { TabMarkdown } from "../../../../ui/tab-markdown/tab-markdown.tsx";
import { useHoverCards } from "../../../issue/hover-card/use-hover-card.ts";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import { AgentName, MovedTo, When, type FeedAgents } from "../byline.tsx";
import { FindingLines } from "./lines/finding-lines.tsx";
import { NoteLine } from "./lines/fold-line.tsx";
import { VerdictLines } from "./lines/verdict-lines.tsx";

type Where = { coordinatorId: CoordinatorId; issueId: IssueId };

/**
 * One round's body as the keyed read holds it: undefined until it is read, null when the round is no
 * longer on record; with the read's error, kept beside what is still shown, and a retry of this
 * round alone.
 */
export function useRoundBody({ coordinatorId, issueId }: Where, round: RoundKey) {
  const key = roundBodyKey(coordinatorId, issueId, round);
  const read = experimental_useRpcKeyedQuery({ contract, method: "roundBodies", keys: [key] });
  return { body: read.data?.[key], error: read.error, retry: () => void read.refetchKeys([key]) };
}

type RoundBodyProps = Where & { round: Round; agents: FeedAgents };

export function RoundBody({ coordinatorId, issueId, round, agents }: RoundBodyProps) {
  const { body, error, retry } = useRoundBody({ coordinatorId, issueId }, round.key);
  const cards = useHoverCards();
  const loaded = body ?? null;
  const loading = body === undefined && error === null;
  return (
    <div className="rmi-round-body" {...cards.board}>
      {error !== null && (
        <ReadFailure onRetry={retry}>
          Could not read round {round.number}: {error.message}
        </ReadFailure>
      )}
      {body === null && <p className="rmi-round-note">This round is no longer on record.</p>}
      <p className="rmi-round-said">{headlineOf(round)}</p>
      {round.review.state === "missed" && <ReviewMissed why={loaded?.reviewMissed ?? null} />}
      {loaded !== null && <FindingLines findings={loaded.findings} own={ownFindingsOf(loaded)} cards={cards} />}
      {loaded?.verdict != null && <VerdictLines verdict={loaded.verdict} by={round.by} cards={cards} />}
      {loading && (
        <p role="status" className="rmi-round-note">
          Loading round {round.number}…
        </p>
      )}
      <Outcome round={round} agents={agents} />
      {loaded?.handoff != null && <Report handoff={loaded.handoff} />}
    </div>
  );
}

/** What the round was: its handoff's summary, or a build parent's final check on its default branch. */
export function headlineOf({ by }: Round): string {
  switch (by.kind) {
    case "agent":
      return by.summary;
    case "final":
      return `Final check on ${by.defaultBranch}`;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      by satisfies never;
      return "";
  }
}

/** A review that wasn't had, and why once the body is read. */
const ReviewMissed = ({ why }: { why: string | null }) => (
  <ul className="rmi-lines" aria-label="Review">
    <NoteLine tone={null} headline="Review missed" detail={why === null ? null : <p className="rmi-fold-claim">{why}</p>} />
  </ul>
);

/** The verifier's own findings, once its verdict returned. */
const ownFindingsOf = ({ verdict }: Body) => (verdict?.state === "returned" ? verdict.findings : []);

/**
 * What became of a returned verdict once it went back to its agent or was made final. why only a
 * returned one: a verdict that never came (could not run, replaced, waived) says so in the verifier's
 * step, or the round's score.
 */
function Outcome({ round, agents }: { round: Round; agents: FeedAgents }) {
  const { verdict, by } = round;
  if (verdict === null || verdict.results.length === 0 || round.inFlight) return null;
  return (
    <p className="rmi-outcome" data-result={verdict.outcome.kind}>
      {/* why one span: a sentence long enough to wrap wraps within itself, not as whole flex items. */}
      <span>{by.kind === "agent" && verdict.fixRound !== null ? <SentBack agent={<AgentName agentId={by.agentId} agents={agents} />} asked={verdict.asked} {...verdict.fixRound} /> : outcomeText(verdict)}</span>
      {round.outcome !== null && <StepTime step={round.outcome} />}
    </p>
  );
}

/**
 * Where a failed verdict's findings went: to its agent as a fix round, or maybe, when the plugin
 * can't tell whether they reached it; then who decides: the user, when its failure asked at the
 * issue's cap (`asked`). why no count of the review's findings: only those that fail it go back
 * (src/server/verify/findings.ts), and the round's score and fold already name them.
 */
function SentBack({ agent, round, delivery, asked }: { agent: ReactNode; asked: DecisionId | null } & NonNullable<NonNullable<Round["verdict"]>["fixRound"]>) {
  switch (delivery) {
    case "sent":
      return (
        <>
          Sent back to {agent} as fix round {round}
        </>
      );
    // why the manager's: the plugin stopped mid-send, or bb's answer didn't say, so nothing shows whether the agent has them.
    case "maybe":
      return (
        <>
          Maybe sent back to {agent} as fix round {round}: {asked === null ? "the regional manager decides" : `at its cap, the plugin asked you (${asked})`}
        </>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      delivery satisfies never;
      return null;
  }
}

/**
 * What became of a verdict nothing went back to an agent from. why the results: one superseded after
 * it returned waited for CI, so it was replaced before CI, not before its verdict. why `asked` first:
 * a failure that asked the user at the issue's cap is theirs to decide, not the regional manager's.
 */
function outcomeText({ outcome, results, asked }: NonNullable<Round["verdict"]>): string {
  if (asked !== null) return `Not sent back: at its cap, the plugin asked you (${asked})`;
  return outcome.kind === "superseded" && results.length > 0 ? "Replaced before CI was judged" : OUTCOME[outcome.kind];
}

const OUTCOME: Record<Outcome, string> = {
  pass: "Passed",
  fail: "Not sent back: the regional manager decides",
  "could-not-run": "No verdict: the regional manager decides",
  superseded: "Replaced before its verdict",
  unverified: "Not verified: verification was off",
  pending: "Waiting for its verdict",
  "waiting-for-ci": "Waiting for CI",
};

/** A step's status move, if any, then its time: " · ◑ Verifying 12:04". */
const StepTime = ({ step }: { step: StepAt }) => (
  <>
    <MovedTo status={step.moved} /> <When at={step.at} />
  </>
);

/** The handoff's own account, folded: what the agent did, its evidence, concerns and the rest, each under its label, and a research handoff's report. */
function Report({ handoff }: { handoff: HandoffBody }) {
  const parts = [
    { title: "Did", items: handoff.did },
    { title: "Evidence", items: handoff.evidence, code: true },
    { title: "Concerns", items: handoff.concerns },
    { title: "Deviations", items: handoff.deviations },
    { title: "Findings", items: handoff.findings },
  ].filter(({ items }) => items.length > 0);
  if (parts.length === 0 && handoff.report === null) return null;
  return (
    <details className="rmi-report-fold">
      <summary>
        <DiscloseGlyph />
        Report
      </summary>
      <div className="rmi-report-parts">
        {handoff.report !== null && <ResearchReport {...handoff.report} />}
        {parts.map(({ title, items, code }) => (
          <section key={title} className="rmi-reported">
            <h4>{title}</h4>
            <ul data-code={code || undefined}>
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

/**
 * A research handoff's report, as the Markdown it is, and the memory file it was saved to. why a box
 * that scrolls: a report runs to 20,000 characters; the tab stop lets the keyboard scroll it.
 */
function ResearchReport({ report, file }: NonNullable<HandoffBody["report"]>) {
  const headId = useId();
  return (
    <section className="rmi-reported">
      <h4 id={headId} className="rmi-report-head">
        Report <span className="rmi-report-file">{file}</span>
      </h4>
      <div tabIndex={0} role="region" aria-labelledby={headId} className="rmi-report">
        <TabMarkdown text={report} />
      </div>
    </section>
  );
}
