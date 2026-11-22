// A machine event in an issue's feed as a quiet line: who did it, when the entry names someone
// (entry.ts actorOf), what happened, and when.
import type { ReactNode } from "react";
import { actorOf, type Actor, type Entry } from "../../../../model/feed/entry.ts";
import type { PrChange } from "../../../../model/verdict/pr.ts";
import { AgentName, When, type FeedAgents } from "./byline.tsx";

/** The entries drawn as lines: everything but rounds and decisions, which are cards. */
type LineEntry = Exclude<Entry, { kind: "round" | "decision" }>;

export function EntryLine({ entry, agents }: { entry: LineEntry; agents: FeedAgents }) {
  return (
    <p className="rmi-line">
      <Who actor={actorOf(entry)} agents={agents} />
      {whatOf(entry, agents)} <When at={entry.at} />
    </p>
  );
}

/** Who did it, named where the entry names someone; a line by GitHub, bb or the plugin itself names no one. */
function Who({ actor, agents }: { actor: Actor; agents: FeedAgents }) {
  switch (actor.kind) {
    case "manager":
      return <span className="rmi-actor">Regional manager </span>;
    case "agent":
      return (
        <>
          <AgentName agentId={actor.agentId} agents={agents} />{" "}
        </>
      );
    case "verifier":
      return <span className="rmi-actor">Verifier </span>;
    case "github":
    case "bb":
    case "plugin":
      return null;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      actor satisfies never;
      return null;
  }
}

function whatOf(entry: LineEntry, agents: FeedAgents): ReactNode {
  switch (entry.kind) {
    case "created":
      return "filed the issue";
    case "agent-started":
      return (
        <>
          started <AgentName agentId={entry.agentId} agents={agents} />
        </>
      );
    case "agent-ended":
      return <Ended agentId={entry.agentId} how={entry.how} agents={agents} />;
    case "pr":
      return entry.changes.flatMap((change) => prChangeText(change, entry.number) ?? []).join(", ");
    case "thread":
      return <ThreadSaid event={entry.event} />;
    case "unblocked":
      return `Unblocked: ${entry.by}, the last of its dependencies, closed`;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      entry satisfies never;
      return null;
  }
}

function Ended({ agentId, how, agents }: { agentId: Extract<Entry, { kind: "agent-ended" }>["agentId"]; how: Extract<Entry, { kind: "agent-ended" }>["how"]; agents: FeedAgents }) {
  const agent = <AgentName agentId={agentId} agents={agents} />;
  switch (how) {
    case "stopped":
      return <>stopped {agent}</>;
    case "replaced":
      return <>handed the issue on from {agent}</>;
    case "archived":
      return <>{agent}'s thread was archived</>;
    case "deleted":
      return <>{agent}'s thread was deleted</>;
    case "spawn-failed":
      return <>{agent} never started: bb didn't confirm its thread</>;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      how satisfies never;
      return null;
  }
}

function ThreadSaid({ event }: { event: Extract<Entry, { kind: "thread" }>["event"] }) {
  switch (event.kind) {
    case "reported-back":
      return (
        <>
          ended its turn with no handoff
          {event.lastAnswer !== null && <span className="rmi-line-quote">{event.lastAnswer}</span>}
        </>
      );
    case "failed":
      return <>failed{event.error !== null && `: ${event.error}`}</>;
    case "needs-input":
      // why the past: the line is a moment of the issue's history, long after the question was answered.
      return <>asked a person: {event.question}</>;
    default:
      // why nothing, not the object: the server may be newer than this bundle for a moment after an update.
      event satisfies never;
      return null;
  }
}

/** A change to the pull request #`number` in words; null for a change this bundle doesn't know, from a newer server. */
function prChangeText(change: PrChange, number: number): string | null {
  switch (change) {
    case "opened":
      return `#${number} opened`;
    case "reopened":
      return `#${number} reopened`;
    case "merged":
      return `#${number} merged`;
    case "closed":
      return `#${number} closed`;
    case "ci-passed":
      return `CI passed on #${number}`;
    case "ci-failed":
      return `CI failed on #${number}`;
    case "approved":
      return `#${number} approved`;
    case "changes-requested":
      return `Changes requested on #${number}`;
    default:
      change satisfies never;
      return null;
  }
}
