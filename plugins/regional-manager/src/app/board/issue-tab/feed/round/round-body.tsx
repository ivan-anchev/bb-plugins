// An open round: its steps on a rail, handed off → reviewer → verifier, then what became of it. The
// steps' lines come from the feed's read; what each opens to (the report, the findings with their
// triage, the verdict) is the round's body, read with the keyed roundBodies query only while the
// round is open, so a folded round costs nothing.
import { experimental_useRpcKeyedQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, type ReactNode } from "react";
import { coordinatorContract as contract, roundBodyKey } from "../../../../../contract.ts";
import type { HandoffBody } from "../../../../../model/agent/handoff.ts";
import type { Round, RoundBody as Body, RoundKey } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { Outcome } from "../../../../../model/verdict/verdict.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
import { ThreadLink } from "../../../issue/thread-link.tsx";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import { AgentName, When, type FeedAgents } from "../byline.tsx";
import { Findings, findingsText } from "./findings.tsx";
import { Score } from "./score.tsx";
import { VerdictStep } from "./verdict-step.tsx";

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
  const loaded = body ?? null;
  const loading = body === undefined && error === null;
  return (
    <div className="rmi-round-body">
      {error !== null && (
        <ReadFailure onRetry={retry}>
          Could not read round {round.number}: {error.message}
        </ReadFailure>
      )}
      {body === null && <p className="rmi-verdict-meta">This round is no longer on record.</p>}
      <ol className="rmi-steps">
        <HandedStep round={round} agents={agents} handoff={loaded?.handoff ?? null} />
        {round.review.state !== "none" && <ReviewStep review={round.review} body={loaded} />}
        {/* why none when waived, or while the review is to come: no verifier ran, or none has started; the round's score says so. */}
        {round.verdict !== null && round.verdict.outcome.kind !== "unverified" && round.review.state !== "pending" && (
          <Step
            title={
              <>
                <ThreadLink name="Verifier" threadId={verifierThreadOf(loaded)} /> <Score round={round} />
                <VerdictTime body={loaded} />
              </>
            }
          >
            {loaded?.verdict != null && <VerdictStep verdict={loaded.verdict} by={round.by} />}
          </Step>
        )}
      </ol>
      {loading && (
        <p role="status" className="rmi-verdict-meta">
          Loading round {round.number}…
        </p>
      )}
      <Outcome round={round} agents={agents} />
    </div>
  );
}

function Step({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <li className="rmi-step">
      <p className="rmi-step-title">{title}</p>
      {children}
    </li>
  );
}

function HandedStep({ round, agents, handoff }: { round: Round; agents: FeedAgents; handoff: HandoffBody | null }) {
  const { by } = round;
  switch (by.kind) {
    case "final":
      return <Step title={<>Final check on {by.defaultBranch} <When at={round.at} /></>} />;
    case "agent":
      return (
        <Step
          title={
            <>
              <AgentName agentId={by.agentId} agents={agents} /> {handedText(by.status)} <When at={round.at} />
            </>
          }
        >
          <p className="rmi-step-text">{by.summary}</p>
          {handoff !== null && <Report handoff={handoff} />}
        </Step>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      by satisfies never;
      return null;
  }
}

function handedText(status: Extract<Round["by"], { kind: "agent" }>["status"]): string {
  switch (status) {
    case "done":
      return "handed off";
    case "blocked":
      return "handed off blocked";
    case "gave-up":
      return "gave up";
    default:
      // why the plain words: a status this bundle doesn't know still handed off, and claims no more.
      status satisfies never;
      return "handed off";
  }
}

/** The review's step: its line from the round, then its findings with their triage, or why none was had, from the body once read. */
function ReviewStep({ review, body }: { review: Exclude<Round["review"], { state: "none" }>; body: Body | null }) {
  switch (review.state) {
    case "pending":
      return <Step title="Reviewer…" />;
    case "missed":
      return (
        <Step
          title={
            <>
              Review missed{body?.reviewMissed != null && `: ${body.reviewMissed}`} <When at={review.step.at} />
            </>
          }
        />
      );
    case "reported":
      return (
        <Step
          title={
            <>
              Reviewer · {findingsText(review)} <When at={review.step.at} />
            </>
          }
        >
          {body !== null && body.findings.length > 0 && <Findings findings={body.findings} />}
        </Step>
      );
    default:
      // why nothing, not the object: the server may be newer than this bundle for a moment after an update.
      review satisfies never;
      return null;
  }
}

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
      <span>{by.kind === "agent" && verdict.fixRound !== null ? <SentBack agent={<AgentName agentId={by.agentId} agents={agents} />} confirmed={confirmedOf(round.review)} {...verdict.fixRound} /> : outcomeText(verdict)}</span>
      {round.outcomeAt !== null && <When at={round.outcomeAt} />}
    </p>
  );
}

/**
 * Where a failed verdict's findings went: to its agent as a fix round, with the review's findings
 * the verifier confirmed (only those reach the agent: src/server/verify/findings.ts), or maybe, when the plugin can't
 * tell whether they reached it.
 */
function SentBack({ agent, round, delivery, confirmed }: { agent: ReactNode; confirmed: number } & NonNullable<NonNullable<Round["verdict"]>["fixRound"]>) {
  const withConfirmed = confirmed === 0 ? "" : `, with the ${confirmed === 1 ? "1 confirmed finding" : `${confirmed} confirmed findings`}`;
  switch (delivery) {
    case "sent":
      return (
        <>
          Sent back to {agent} as fix round {round}
          {withConfirmed}
        </>
      );
    // why the manager's: the plugin stopped mid-send, or bb's answer didn't say, so nothing shows whether the agent has them.
    case "maybe":
      return (
        <>
          Maybe sent back to {agent} as fix round {round}
          {withConfirmed}: the regional manager decides
        </>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      delivery satisfies never;
      return null;
  }
}

/** How many of the review's findings the verifier confirmed; 0 when it had no review, or none was confirmed. */
const confirmedOf = (review: Round["review"]): number => (review.state === "reported" ? (review.confirmed ?? 0) : 0);

/** What became of a verdict nothing went back to an agent from. why the results: one superseded after it returned waited for CI, so it was replaced before CI, not before its verdict. */
function outcomeText({ outcome, results }: NonNullable<Round["verdict"]>): string {
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

/** When the verdict returned or couldn't be had, once the body is read; nothing before. */
function VerdictTime({ body }: { body: Body | null }) {
  const verdict = body?.verdict ?? null;
  return verdict !== null && (verdict.state === "returned" || verdict.state === "could-not-run") ? <When at={verdict.at} /> : null;
}

const verifierThreadOf = (body: Body | null): string | null => {
  const verdict = body?.verdict ?? null;
  return verdict !== null && (verdict.state === "running" || verdict.state === "returned" || verdict.state === "could-not-run") ? verdict.verifierThreadId : null;
};

/** The handoff's own account, folded: what the agent did, its evidence, concerns and the rest, and a research handoff's report. */
function Report({ handoff }: { handoff: HandoffBody }) {
  const parts = [
    { title: "Did", counted: "did", items: handoff.did },
    { title: "Evidence", counted: "evidence", items: handoff.evidence, code: true },
    { title: "Concerns", counted: "concern", items: handoff.concerns },
    { title: "Deviations", counted: "deviation", items: handoff.deviations },
    { title: "Findings", counted: "finding", items: handoff.findings },
  ].filter(({ items }) => items.length > 0);
  if (parts.length === 0 && handoff.report === null) return null;
  // why only some take an s: "3 did" and "2 evidence" read as they are.
  const counted = parts.map(({ counted: word, items }) => `${items.length} ${items.length === 1 || word === "did" || word === "evidence" ? word : `${word}s`}`).join(" · ");
  return (
    <details className="rmi-report-fold">
      <summary>
        <DiscloseGlyph />
        Report{counted !== "" && ` · ${counted}`}
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
        <Markdown content={report} />
      </div>
    </section>
  );
}
