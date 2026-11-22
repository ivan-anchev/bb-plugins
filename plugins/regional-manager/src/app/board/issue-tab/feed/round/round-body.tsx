// An open round: its steps on a rail, handed off → reviewer → verifier, then what became of it. The
// steps' lines come from the feed's read; what each opens to (the report, the findings with their
// triage, the verdict) is the round's body, read with the keyed roundBodies query only while the
// round is open, so a folded round costs nothing.
import { experimental_useRpcKeyedQuery, Markdown } from "@get-bb/plugin-sdk/app";
import { useId, type ReactNode } from "react";
import { coordinatorContract as contract, roundBodyKey } from "../../../../../contract.ts";
import type { HandoffBody, Round, RoundBody as Body, RoundKey } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import type { Outcome } from "../../../../../model/verdict/verdict.ts";
import { ReadFailure } from "../../../../ui/read-failure.tsx";
import { ThreadLink } from "../../../issue/thread-link.tsx";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import { AgentName, When, type FeedAgents } from "../byline.tsx";
import { Findings } from "./findings.tsx";
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
        {round.review.state !== "none" && <ReviewStep review={round.review} findings={loaded?.findings ?? []} />}
        {round.verdict !== null && (
          <Step
            title={
              <>
                <ThreadLink name="Verifier" threadId={verifierThreadOf(loaded)} /> <Score round={round} />
                <VerdictTime body={loaded} />
              </>
            }
          >
            {loaded?.verdict != null && <VerdictStep verdict={loaded.verdict} judged={round.by.kind === "agent" ? { kind: "handoff" } : { kind: "final", defaultBranch: round.by.defaultBranch }} />}
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
  if (by.kind === "final") return <Step title={<>Final check on {by.defaultBranch} <When at={round.at} /></>} />;
  return (
    <Step
      title={
        <>
          <AgentName agentId={by.agentId} agents={agents} /> {HANDED[by.status]} <When at={round.at} />
        </>
      }
    >
      <p className="rmi-step-text">{by.summary}</p>
      {handoff !== null && <Report handoff={handoff} />}
    </Step>
  );
}

const HANDED: Record<Extract<Round["by"], { kind: "agent" }>["status"], string> = { done: "handed off", blocked: "handed off blocked", "gave-up": "gave up" };

function ReviewStep({ review, findings }: { review: Exclude<Round["review"], { state: "none" }>; findings: Body["findings"] }) {
  switch (review.state) {
    case "pending":
      return <Step title="Reviewer is reviewing…" />;
    case "missed":
      return (
        <Step
          title={
            <>
              No review: {review.reason} <When at={review.at} />
            </>
          }
        />
      );
    case "reported":
      return (
        <Step
          title={
            <>
              {reviewedText(review)} <When at={review.at} />
            </>
          }
        >
          {findings.length > 0 && <Findings findings={findings} />}
        </Step>
      );
    default:
      // why nothing, not the object: the server may be newer than this bundle for a moment after an update.
      review satisfies never;
      return null;
  }
}

/** What the reviewer found, and how many of it the verifier confirmed once its verdict triaged them. */
function reviewedText({ findings, confirmed }: Extract<Round["review"], { state: "reported" }>): string {
  if (findings === 0) return "Reviewer found nothing";
  const found = `Reviewer found ${findings === 1 ? "1 issue" : `${findings} issues`}`;
  return confirmed === null ? found : `${found}, ${confirmed} confirmed`;
}

/** What became of the round, once its verdict went back to its agent or was made final. */
function Outcome({ round, agents }: { round: Round; agents: FeedAgents }) {
  const { verdict, by } = round;
  if (verdict === null || round.inFlight) return null;
  const sentTo = by.kind === "agent" && verdict.fixRound !== null ? by.agentId : null;
  return (
    <p className="rmi-outcome" data-result={verdict.outcome}>
      {sentTo !== null ? (
        <>
          Sent back to <AgentName agentId={sentTo} agents={agents} /> as fix round {verdict.fixRound}
        </>
      ) : (
        OUTCOME[verdict.outcome]
      )}
      {round.outcomeAt !== null && <When at={round.outcomeAt} />}
    </p>
  );
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
