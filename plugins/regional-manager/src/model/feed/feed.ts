// An issue's feed: every moment the record holds about it, in the order it happened. Pure: the
// reader gathers FeedFacts from the store (feed-reader.ts), this merges them.
import type { Agent } from "../agent/agent.ts";
import type { IssueDecision } from "../decision.ts";
import type { InboxEvent, StoredEvent } from "../inbox/inbox-event.ts";
import type { Issue } from "../issue/issue.ts";
import type { Handed } from "../issue/status.ts";
import type { FinalCheck } from "../verdict/check.ts";
import { timeOf, type Entry } from "./entry.ts";
import { finalRoundOf, roundOf, type Round } from "./round.ts";

/** Everything one issue's feed is made of, each list as its table holds it, oldest first. */
type FeedFacts = {
  issue: Pick<Issue, "createdAt">;
  agents: readonly Pick<Agent, "id" | "startedAt" | "ended">[];
  handed: readonly Handed[];
  finalChecks: readonly FinalCheck[];
  decisions: readonly IssueDecision[];
  /** The inbox events naming the issue, in the order recorded. */
  events: readonly StoredEvent[];
};

/** The issue's feed, oldest first; two moments at one millisecond keep the order listed here. */
export function feedOf(facts: FeedFacts): Entry[] {
  const entries: Entry[] = [
    { kind: "created", at: facts.issue.createdAt },
    ...facts.agents.flatMap(agentEntries),
    ...roundsOf(facts).map((round): Entry => ({ kind: "round", round })),
    ...facts.decisions.map((decision): Entry => ({ kind: "decision", decision })),
    ...facts.events.flatMap(({ at, event }) => eventEntries(at, event)),
  ];
  return sortByTime(entries.map((entry) => ({ at: timeOf(entry), entry }))).map(({ entry }) => entry);
}

/** Rounds numbered in the order they began: every handoff, and a build parent's final checks. */
function roundsOf({ handed, finalChecks, events }: FeedFacts): Round[] {
  const outcomeAt = outcomeTimes(events);
  const begun = sortByTime([
    ...handed.map((one) => ({ at: one.handoff.at, make: (n: number) => roundOf(one, n, one.check === null ? null : (outcomeAt.get(one.check.id) ?? null)) })),
    ...finalChecks.map((check) => ({ at: check.at, make: (n: number) => finalRoundOf(check, n, outcomeAt.get(check.id) ?? null) })),
  ]);
  return begun.map(({ make }, i) => make(i + 1));
}

/** When each check's outcome was announced: the first `checked` or `sent-back` event naming it. */
function outcomeTimes(events: readonly StoredEvent[]): Map<string, number> {
  const times = new Map<string, number>();
  for (const { at, event } of events) {
    if ((event.kind === "checked" || event.kind === "sent-back") && !times.has(event.checkId)) times.set(event.checkId, at);
  }
  return times;
}

function agentEntries({ id, startedAt, ended }: FeedFacts["agents"][number]): Entry[] {
  const started: Entry = { kind: "agent-started", at: startedAt, agentId: id };
  return ended === null ? [started] : [started, { kind: "agent-ended", at: ended.at, agentId: id, how: ended.how }];
}

/** The inbox events the feed shows as lines; a round tells the rest of the work (handoff, checked, sent-back), an agent's end its return to Todo. */
function eventEntries(at: number, event: InboxEvent): Entry[] {
  switch (event.kind) {
    case "pr":
      return [{ kind: "pr", at, number: event.pr.number, changes: event.changes }];
    case "idle-without-handoff":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "reported-back", lastAnswer: event.lastAnswer } }];
    case "failed":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "failed", error: event.error } }];
    case "needs-input":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "needs-input", question: event.question } }];
    case "unblocked":
      return [{ kind: "unblocked", at, by: event.by }];
    case "handoff":
    case "checked":
    case "sent-back":
    case "returned-to-todo":
    case "verification-toggled":
    case "memory-edited":
    case "reminder":
    case "decision-answered":
    case "coordinator-edited-files":
    case "coordinator-tree-clean":
      return [];
    default:
      return event satisfies never;
  }
}

/** Sorted by time; why stable: two moments of one millisecond keep the order their sources gave. */
const sortByTime = <T extends { at: number }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.at - b.at);
