// A round in an issue's feed: folded, one line with its number, what was handed off, what its
// reviewer found, its score and when it was handed off; open, its number, its verdict in a word and
// when, over its body (round-body.tsx). Whether it is open
// is the reader's choice, kept by the feed (feed.tsx); a round nobody chose opens while it is the latest.
import { useId } from "react";
import type { Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import { When, type FeedAgents } from "../byline.tsx";
import { headlineOf, RoundBody } from "./round-body.tsx";
import { AskedNote, Score } from "./score.tsx";

/** `onEngage`: the reader pressed or focused something inside the open round, which keeps it open as theirs. */
type RoundCardProps = { coordinatorId: CoordinatorId; issueId: IssueId; round: Round; agents: FeedAgents; open: boolean; onToggle(): void; onEngage(): void };

export function RoundCard({ coordinatorId, issueId, round, agents, open, onToggle, onEngage }: RoundCardProps) {
  const bodyId = useId();
  return (
    <article className="rmi-round" data-open={open || undefined} aria-label={`Round ${round.number}`}>
      <button type="button" className="rmi-round-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <DiscloseGlyph />
        <span className="rmi-round-name">Round {round.number}</span>
        <span className="rmi-round-summary" title={headlineOf(round)}>
          {headlineOf(round)}
        </span>
        <FoundCount review={round.review} />
        <Score round={round} open={open} />
        <AskedNote asked={round.verdict?.asked ?? null} />
        <When at={round.handed.at} />
      </button>
      <div id={bodyId} hidden={!open} onFocusCapture={onEngage} onPointerDownCapture={onEngage}>
        {open && <RoundBody coordinatorId={coordinatorId} issueId={issueId} round={round} agents={agents} />}
      </div>
    </article>
  );
}

/** What the round's reviewer reported and how much of it held: "3 findings, 2 held (1 downgraded)", or "No findings"; nothing without a review that reported. */
function FoundCount({ review }: { review: Round["review"] }) {
  if (review.state !== "reported") return null;
  return <span className="rmi-round-found">{findingsText(review)}</span>;
}

/** How many findings the review reported and, once the verdict triaged them, how many held and were downgraded: "3 findings, 2 held (1 downgraded)". */
function findingsText({ findings, held, downgraded }: Extract<Round["review"], { state: "reported" }>): string {
  const found = findings === 0 ? "No findings" : `${findings} ${findings === 1 ? "finding" : "findings"}`;
  if (held === null || findings === 0) return found;
  return downgraded === null || downgraded === 0 ? `${found}, ${held} held` : `${found}, ${held} held (${downgraded} downgraded)`;
}
