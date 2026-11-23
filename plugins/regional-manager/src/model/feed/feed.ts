// An issue's feed: every moment the record holds about it, in the order it happened, each with the
// status the plugin observed the issue move to after it. Pure: the reader gathers FeedFacts from the
// store (feed-reader.ts), this merges them. A status is only ever as logged (log-store.ts
// observeStatuses), never derived here from what happened.
import type { Agent } from "../agent/agent.ts";
import type { IssueDecision } from "../decision.ts";
import type { InboxEvent, StoredEvent } from "../inbox/inbox-event.ts";
import type { Issue } from "../issue/issue.ts";
import type { Handed, IssueStatus } from "../issue/status.ts";
import type { FinalCheck } from "../verdict/check.ts";
import { timeOf, type Entry } from "./entry.ts";
import type { Logged } from "./log-event.ts";
import { finalRoundOf, roundOf, type Round, type Step } from "./round.ts";

/** Everything one issue's feed is made of, each list as its table holds it, oldest first. */
type FeedFacts = {
  issue: Pick<Issue, "createdAt">;
  agents: readonly Pick<Agent, "id" | "startedAt" | "ended">[];
  handed: readonly Handed[];
  finalChecks: readonly FinalCheck[];
  decisions: readonly IssueDecision[];
  /** The inbox events naming the issue, in the order recorded. */
  events: readonly StoredEvent[];
  /** The issue's log, in the order written. */
  log: readonly Logged[];
};

/** The issue's feed, oldest first; two moments at one millisecond keep the order listed here, the log's rows in the order written. */
export function feedOf(facts: FeedFacts): Entry[] {
  const { lines, statuses, began } = readLog(facts.log);
  const others: Entry[] = [
    { kind: "created", at: facts.issue.createdAt, moved: null },
    ...facts.agents.flatMap(agentEntries),
    ...roundsOf(facts).map((round): Entry => ({ kind: "round", round })),
    ...facts.decisions.map((decision): Entry => ({ kind: "decision", decision, moved: null })),
    ...facts.events.flatMap(({ at, event }) => eventEntries(at, event)),
  ];
  const placed = inOrder([...others.map((entry) => ({ at: timeOf(entry), seq: NOT_LOGGED, entry })), ...lines]);
  return inOrder(attachStatuses(placed, statuses, began)).map(({ entry }) => entry);
}

/**
 * Where something sits in the issue's history: its time, then, for a row of its log, its place
 * there. why the log's place: rows of one millisecond keep the order they were written in, and a
 * fact from another table at that millisecond comes before them, as the read that logs a status
 * follows the write it saw.
 */
type Point = { at: number; seq: number };
const NOT_LOGGED = -1;
const isAfter = (a: Point, b: Point): boolean => a.at > b.at || (a.at === b.at && a.seq > b.seq);
const inOrder = <T extends Point>(items: readonly T[]): T[] => [...items].sort((a, b) => a.at - b.at || a.seq - b.seq);

type Placed = Point & { entry: Entry };
type Observed = Point & { status: IssueStatus };

/**
 * The log as the feed shows it: its lines, the statuses observed, and where it began for an issue
 * filed before it (null: filed since, so it holds everything). why a status before it began is
 * dropped: nothing before then was observed, so nothing above the marker shows one.
 */
function readLog(log: readonly Logged[]): { lines: Placed[]; statuses: Observed[]; began: Point | null } {
  const rows = log.map((row, seq) => ({ ...row, seq }));
  const marker = rows.find(({ event }) => event.kind === "log-began") ?? null;
  const statuses = rows.flatMap(({ at, seq, event }) => (event.kind === "status" && (marker === null || seq > marker.seq) ? [{ at, seq, status: event.status }] : []));
  const lines = rows.flatMap(({ at, seq, event }): Placed[] => (event.kind === "status" ? [] : [{ at, seq, entry: { kind: "logged", at, event, moved: null } }]));
  return { lines, statuses, began: marker === null ? null : { at: marker.at, seq: marker.seq } };
}

/** A moment a status can be shown on: an entry, or one step of a round, the `entry`th placed. */
type Moment = Point & { entry: number; step: "handed" | "review" | "verdict" | "outcome" | null };

/**
 * Each observed status on the latest moment after the status before it (and after the log began)
 * and not after itself: the moment it followed. A status no such moment explains, as a parent
 * rolling up or a turn ending, is a `moved` entry of its own. `placed` in order.
 */
function attachStatuses(placed: readonly Placed[], statuses: readonly Observed[], began: Point | null): Placed[] {
  // why only the moments of entries below the marker: one above it, as a round begun before the log,
  // shows nothing observed, so none of its steps takes a status, and a later move of it is a line of its own.
  const below = placed.flatMap((one, index) => (began === null || isAfter(one, began) ? momentsOf(one, index) : []));
  // why by each moment's own place: a round's later steps come after entries that follow its start. why latest first: the moment a status followed is the last one before it.
  const latestFirst = inOrder(below).reverse();
  const shown = new Map<string, IssueStatus>();
  const unexplained: Placed[] = [];
  let since = began;
  for (const observed of statuses) {
    const moment = latestFirst.find((candidate) => (since === null || isAfter(candidate, since)) && !isAfter(candidate, observed));
    if (moment === undefined) unexplained.push({ at: observed.at, seq: observed.seq, entry: { kind: "moved", at: observed.at, status: observed.status } });
    else shown.set(momentKey(moment.entry, moment.step), observed.status);
    since = observed;
  }
  return [...placed.map((one, i) => ({ ...one, entry: withMoved(one.entry, (step) => shown.get(momentKey(i, step)) ?? null) })), ...unexplained];
}

const momentKey = (entry: number, step: Moment["step"]): string => `${entry}:${step}`;

/** The moments of the `index`th placed entry: a round's steps that happened, or the entry itself. why not a `moved` entry: it is a status already. */
function momentsOf({ entry, at, seq }: Placed, index: number): Moment[] {
  switch (entry.kind) {
    case "round": {
      const { handed, review, verdict, outcome } = entry.round;
      const steps: [Moment["step"], Step | null][] = [["handed", handed], ["review", reviewStep(review)], ["verdict", verdict?.step ?? null], ["outcome", outcome]];
      return steps.flatMap(([step, happened]) => (happened === null ? [] : [{ at: happened.at, seq: NOT_LOGGED, entry: index, step }]));
    }
    case "moved":
      return [];
    case "created":
    case "logged":
    case "agent-started":
    case "agent-ended":
    case "decision":
    case "pr":
    case "thread":
    case "unblocked":
      return [{ at, seq, entry: index, step: null }];
    default:
      return entry satisfies never;
  }
}

/** When a round's review was had or missed; null while it is to come, or with none. */
const reviewStep = (review: Round["review"]): Step | null => (review.state === "missed" || review.state === "reported" ? review.step : null);

/** The entry with the status `movedOf` gives each of its moments. */
function withMoved(entry: Entry, movedOf: (step: Moment["step"]) => IssueStatus | null): Entry {
  switch (entry.kind) {
    case "round": {
      const { round } = entry;
      const step = (name: Moment["step"], one: Step): Step => ({ ...one, moved: movedOf(name) });
      const review = round.review.state === "missed" || round.review.state === "reported" ? { ...round.review, step: step("review", round.review.step) } : round.review;
      const verdict = round.verdict === null ? null : { ...round.verdict, step: round.verdict.step === null ? null : step("verdict", round.verdict.step) };
      return { kind: "round", round: { ...round, handed: step("handed", round.handed), review, verdict, outcome: round.outcome === null ? null : step("outcome", round.outcome) } };
    }
    case "moved":
      return entry;
    case "created":
    case "logged":
    case "agent-started":
    case "agent-ended":
    case "decision":
    case "pr":
    case "thread":
    case "unblocked":
      return { ...entry, moved: movedOf(null) };
    default:
      return entry satisfies never;
  }
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
  const started: Entry = { kind: "agent-started", at: startedAt, agentId: id, moved: null };
  return ended === null ? [started] : [started, { kind: "agent-ended", at: ended.at, agentId: id, how: ended.how, moved: null }];
}

/** The inbox events the feed shows as lines; a round tells the rest of the work (handoff, checked, sent-back), an agent's end its return to Todo. */
function eventEntries(at: number, event: InboxEvent): Entry[] {
  switch (event.kind) {
    case "pr":
      return [{ kind: "pr", at, number: event.pr.number, changes: event.changes, moved: null }];
    case "idle-without-handoff":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "reported-back", lastAnswer: event.lastAnswer }, moved: null }];
    case "failed":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "failed", error: event.error }, moved: null }];
    case "needs-input":
      return [{ kind: "thread", at, agentId: event.agentId, event: { kind: "needs-input", question: event.question }, moved: null }];
    case "unblocked":
      return [{ kind: "unblocked", at, by: event.by, moved: null }];
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
