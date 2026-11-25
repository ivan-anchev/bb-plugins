// A round in an issue's feed: folded, one line with its number, what was handed off, what its
// reviewer found and its score; open, its steps and its body (round-body.tsx). Whether it is open
// is the reader's choice, kept by the feed (feed.tsx); a round nobody chose opens while it is the latest.
import { useId } from "react";
import type { Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import type { FeedAgents } from "../byline.tsx";
import { findingsText } from "./findings.tsx";
import { RoundBody } from "./round-body.tsx";
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
        <Score round={round} />
        <AskedNote asked={round.verdict?.asked ?? null} />
      </button>
      <div id={bodyId} hidden={!open} onFocusCapture={onEngage} onPointerDownCapture={onEngage}>
        {open && <RoundBody coordinatorId={coordinatorId} issueId={issueId} round={round} agents={agents} />}
      </div>
    </article>
  );
}

/** What the round was: its handoff's summary, or a build parent's final check on its default branch. */
function headlineOf({ by }: Round): string {
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

/** What the round's reviewer reported and the verifier confirmed: "2 findings, 1 confirmed", or "No findings"; nothing without a review that reported. */
function FoundCount({ review }: { review: Round["review"] }) {
  if (review.state !== "reported") return null;
  return <span className="rmi-round-found">{findingsText(review)}</span>;
}
