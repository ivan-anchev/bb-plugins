// An issue's feed in its tab: the criteria × rounds grid, then Activity, every entry in the order it
// happened, each drawn by its kind, under a filter: All, Rounds or Discussion. The entries are the
// issueFeed read's; the filter and which rounds are open are the reader's own choices, kept in state
// across reads and never seeded from one.
import "./feed.css";
import { useId, useState } from "react";
import type { IssueFeed, IssueRow } from "../../../../contract.ts";
import { shownIn, type Entry, type Filter } from "../../../../model/feed/entry.ts";
import type { Round, RoundKey } from "../../../../model/feed/round.ts";
import { isVerified } from "../../../../model/issue/kind.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import type { FeedAgents } from "./byline.tsx";
import { DecisionCard } from "./decision-card.tsx";
import { EntryLine } from "./entry-line.tsx";
import { CriteriaGrid } from "./round/criteria-grid.tsx";
import { RoundCard } from "./round/round-card.tsx";

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
  const shown = feed.entries.filter((entry) => shownIn(filter, entry));
  return (
    <>
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
          <p className="rmi-verdict-meta">{filter === "discussion" ? "No decisions or questions yet." : "No rounds yet."}</p>
        ) : (
          <ol className="rmi-entries">
            {shown.map((entry, i) => (
              <li key={keyOf(entry, i)}>
                <EntryView coordinatorId={coordinatorId} issue={issue} agents={feed.agents} entry={entry} isOpen={isOpen} onToggle={toggle} onEngage={engage} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

type EntryViewProps = { coordinatorId: CoordinatorId; issue: IssueRow; agents: FeedAgents; entry: Entry; isOpen(round: Round): boolean; onToggle(round: Round): void; onEngage(round: Round): void };

/** One entry, by its kind: a round as its card, a decision as its card, anything else as a quiet line. */
function EntryView({ coordinatorId, issue, agents, entry, isOpen, onToggle, onEngage }: EntryViewProps) {
  switch (entry.kind) {
    case "round":
      return <RoundCard coordinatorId={coordinatorId} issueId={issue.id} round={entry.round} agents={agents} open={isOpen(entry.round)} onToggle={() => onToggle(entry.round)} onEngage={() => onEngage(entry.round)} />;
    case "decision":
      return <DecisionCard coordinatorId={coordinatorId} decision={entry.decision} />;
    case "created":
    case "agent-started":
    case "agent-ended":
    case "pr":
    case "thread":
    case "unblocked":
      return <EntryLine entry={entry} agents={agents} />;
    default:
      // why nothing, not a throw: for a moment after an update, the server may send a kind this bundle doesn't know.
      entry satisfies never;
      return null;
  }
}

const roundsIn = (entries: readonly Entry[]): Round[] => entries.flatMap((entry) => (entry.kind === "round" ? [entry.round] : []));

/** A round's or a question's own id, which keeps its state across reads; anything else, which keeps none, by its place. */
function keyOf(entry: Entry, place: number): string {
  if (entry.kind === "round") return entry.round.key;
  if (entry.kind === "decision" && entry.decision.kind === "asked") return entry.decision.id;
  return `${entry.kind}-${place}`;
}
