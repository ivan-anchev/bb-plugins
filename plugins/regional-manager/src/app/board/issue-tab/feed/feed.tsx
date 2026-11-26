// An issue's feed in its tab: the criteria × rounds grid, then Activity, every entry in the order it
// happened, each drawn by its kind, under a filter: All, Rounds or Discussion. The entries are the
// issueFeed read's; the filter and which rounds are open are the reader's own choices, kept in state
// across reads and never seeded from one. Asked from the issue's row under Needs you, it shows the
// question that has waited longest, focused on its first row (question-reveal.ts).
import "./feed.css";
import { useEffect, useId, useState } from "react";
import type { IssueFeed, IssueRow } from "../../../../contract.ts";
import { shownIn, type Entry, type Filter } from "../../../../model/feed/entry.ts";
import type { Round, RoundKey } from "../../../../model/feed/round.ts";
import { isVerified } from "../../../../model/issue/kind.ts";
import { isClosed } from "../../../../model/issue/relations.ts";
import type { IssueStatus } from "../../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import type { FeedAgents } from "./byline.tsx";
import type { Comment, CommentId } from "../../../../model/feed/comment.ts";
import type { DecisionId } from "../../../../model/decision.ts";
import { stillWaits } from "../../../../model/verdict/rounds/cap.ts";
import { useQuestionReveal } from "../question-reveal.ts";
import { CommentCard } from "./comment-card.tsx";
import { CommentComposer } from "./comment-composer.tsx";
import { DecisionCard } from "./decision/decision-card.tsx";
import { EntryLine, MovedLine } from "./entry-line.tsx";
import { CriteriaGrid } from "./round/criteria-grid.tsx";
import { RoundCard } from "./round/round-card.tsx";
import { CapCounts } from "./round/score.tsx";

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "rounds", label: "Rounds" },
  { value: "discussion", label: "Discussion" },
];

type FeedProps = { coordinatorId: CoordinatorId; issue: IssueRow; feed: IssueFeed };

export function Feed({ coordinatorId, issue, feed }: FeedProps) {
  const titleId = useId();
  const [filter, setFilter] = useState<Filter>("all");
  // The rounds the reader opened, folded or engaged with. why only their choices: a read that brings a
  // new round keeps what they chose, and a round nobody chose is open while it is the latest. why
  // engaging counts: a new round must not fold the one the reader is reading, or drop focus inside it.
  const [chosen, setChosen] = useState<ReadonlyMap<RoundKey, boolean>>(new Map());
  const rounds = roundsIn(feed.entries);
  const latest = rounds.at(-1)?.key ?? null;
  const isOpen = (round: Round): boolean => chosen.get(round.key) ?? round.key === latest;
  const toggle = (round: Round) => setChosen((now) => new Map(now).set(round.key, !isOpen(round)));
  const engage = (round: Round) => setChosen((now) => (now.has(round.key) ? now : new Map(now).set(round.key, true)));
  const { asked, taken } = useQuestionReveal(coordinatorId, issue.id);
  const revealing = asked ? oldestWaiting(feed.entries, issue.status) : null;
  // why during render: a reveal asked while Rounds hides the questions shows them all.
  if (revealing !== null && filter === "rounds") setFilter("all");
  useEffect(
    function takeRevealOfNone() {
      // why an effect: the request lives outside React, in the app's memory the Board shares.
      if (asked && revealing === null) taken();
    },
    [asked, taken, revealing],
  );
  const shown = feed.entries.filter((entry) => shownIn(filter, entry));
  const comments = commentsIn(feed.entries);
  return (
    <CapCounts.Provider value={capCountsIn(feed.entries)}>
      {feed.doneCriteria.length > 0 && <CriteriaGrid coordinatorId={coordinatorId} issueId={issue.id} verified={isVerified(issue.kind)} criteria={feed.doneCriteria} rounds={rounds} />}
      <section className="rmi-part" aria-labelledby={titleId}>
        <div className="rmi-section-head">
          <h3 id={titleId} className="rmi-part-title">
            Activity
          </h3>
          <div role="group" aria-label="Show" className="rmi-filter">
            {FILTERS.map(({ value, label }) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="rmi-verdict-meta">{filter === "discussion" ? "No comments, decisions or questions yet." : "No rounds yet."}</p>
        ) : (
          <ol className="rmi-entries">
            {shown.map((entry, i) => (
              <li key={keyOf(entry, i)}>
                <EntryView coordinatorId={coordinatorId} issue={issue} agents={feed.agents} comments={comments} entry={entry} revealing={revealing} onRevealed={taken} isOpen={isOpen} onToggle={toggle} onEngage={engage} />
              </li>
            ))}
          </ol>
        )}
        <CommentComposer coordinatorId={coordinatorId} issueId={issue.id} posted={comments} />
      </section>
    </CapCounts.Provider>
  );
}

type EntryViewProps = {
  coordinatorId: CoordinatorId;
  issue: IssueRow;
  agents: FeedAgents;
  comments: ReadonlyMap<CommentId, Comment>;
  entry: Entry;
  /** The question asked to be shown, null for none; `onRevealed` once it showed. */
  revealing: DecisionId | null;
  onRevealed(): void;
  isOpen(round: Round): boolean;
  onToggle(round: Round): void;
  onEngage(round: Round): void;
};

/** One entry, by its kind: a round, a decision or a comment as its card, anything else as a quiet row. */
function EntryView({ coordinatorId, issue, agents, comments, entry, revealing, onRevealed, isOpen, onToggle, onEngage }: EntryViewProps) {
  switch (entry.kind) {
    case "round":
      return <RoundCard coordinatorId={coordinatorId} issueId={issue.id} round={entry.round} agents={agents} open={isOpen(entry.round)} onToggle={() => onToggle(entry.round)} onEngage={() => onEngage(entry.round)} />;
    case "decision":
      return <DecisionCard coordinatorId={coordinatorId} decision={entry.decision} status={issue.status} onRevealed={entry.decision.kind === "asked" && entry.decision.id === revealing ? onRevealed : null} />;
    case "comment": {
      const { replyTo } = entry.comment;
      return <CommentCard coordinatorId={coordinatorId} entry={entry} answered={replyTo === null ? null : (comments.get(replyTo) ?? null)} agents={agents} />;
    }
    case "moved":
      return <MovedLine entry={entry} />;
    case "created":
    case "logged":
    case "agent-started":
    case "agent-ended":
    case "pr":
    case "thread":
    case "follow-up":
    case "unblocked":
      return <EntryLine entry={entry} agents={agents} />;
    default:
      // why nothing, not a throw: for a moment after an update, the server may send a kind this bundle doesn't know.
      entry satisfies never;
      return null;
  }
}

/** The feed's comments, by id. */
const commentsIn = (entries: readonly Entry[]): Map<CommentId, Comment> => new Map(entries.flatMap((entry) => (entry.kind === "comment" ? [[entry.comment.id, entry.comment] as const] : [])));

/** Each cap question among the entries, by its id, with the count it was asked at (score.tsx CapCounts). */
const capCountsIn = (entries: readonly Entry[]): ReadonlyMap<DecisionId, number> =>
  new Map(entries.flatMap((entry) => (entry.kind === "decision" && entry.decision.kind === "asked" && entry.decision.cap !== null ? [[entry.decision.id, entry.decision.cap] as const] : [])));

/** The question among the entries that has waited longest for the user's answer (rounds/cap.ts stillWaits); null: none waits. why the first: the entries are in the order they happened. */
function oldestWaiting(entries: readonly Entry[], status: IssueStatus): DecisionId | null {
  const waiting = entries.flatMap((entry) => (entry.kind === "decision" && entry.decision.kind === "asked" && stillWaits(entry.decision, isClosed(status)) ? [entry.decision.id] : []));
  return waiting[0] ?? null;
}

const roundsIn = (entries: readonly Entry[]): Round[] => entries.flatMap((entry) => (entry.kind === "round" ? [entry.round] : []));

/** A round's, a question's or a comment's own id, which keeps its state across reads; anything else, which keeps none, by its place. */
function keyOf(entry: Entry, place: number): string {
  if (entry.kind === "round") return entry.round.key;
  if (entry.kind === "comment") return entry.comment.id;
  if (entry.kind === "decision" && entry.decision.kind === "asked") return entry.decision.id;
  return `${entry.kind}-${place}`;
}
