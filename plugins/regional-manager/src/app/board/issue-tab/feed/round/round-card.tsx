// A round in an issue's feed: folded, one line with its number, what was handed off and its score;
// open, its steps and its body (round-body.tsx). Whether it is open is the reader's choice, kept by
// the feed (feed.tsx); a round nobody chose opens while it is the latest.
import { useId } from "react";
import type { Round } from "../../../../../model/feed/round.ts";
import type { IssueId } from "../../../../../model/issue/issue.ts";
import type { CoordinatorId } from "../../../../../model/role.ts";
import { DiscloseGlyph } from "../../detail/disclose-glyph.tsx";
import type { FeedAgents } from "../byline.tsx";
import { RoundBody } from "./round-body.tsx";
import { Score } from "./score.tsx";

type RoundCardProps = { coordinatorId: CoordinatorId; issueId: IssueId; round: Round; agents: FeedAgents; open: boolean; onToggle(): void };

export function RoundCard({ coordinatorId, issueId, round, agents, open, onToggle }: RoundCardProps) {
  const bodyId = useId();
  return (
    <article className="rmi-round" data-open={open || undefined} aria-label={`Round ${round.number}`}>
      <button type="button" className="rmi-round-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <DiscloseGlyph />
        <span className="rmi-round-name">Round {round.number}</span>
        <span className="rmi-round-summary">{headlineOf(round)}</span>
        <Score round={round} />
      </button>
      <div id={bodyId} hidden={!open}>
        {open && <RoundBody coordinatorId={coordinatorId} issueId={issueId} round={round} agents={agents} />}
      </div>
    </article>
  );
}

/** What the round was: its handoff's summary, or a build parent's final check on its default branch. */
const headlineOf = ({ by }: Round): string => (by.kind === "agent" ? by.summary : `Final check on ${by.defaultBranch}`);
