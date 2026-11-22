// A machine event in an issue's feed as a quiet line: who did it, when the entry names someone
// (entry.ts actorOf), what happened, and when.
import type { ReactNode } from "react";
import { actorOf, type Actor, type Entry } from "../../../../model/feed/entry.ts";
import type { PrChange } from "../../../../model/verdict/pr.ts";
import { AgentName, When, type FeedAgents } from "./byline.tsx";

/** The entries drawn as lines: everything but rounds and decisions, which are cards. */
export type LineEntry = Exclude<Entry, { kind: "round" | "decision" }>;

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
      return actor satisfies never;
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
      return entry.changes.map((change) => PR_CHANGE[change](entry.number)).join(", ");
    case "thread":
      return <ThreadSaid event={entry.event} />;
    case "unblocked":
      return `Unblocked: ${entry.by}, the last of its dependencies, closed`;
    default:
      return entry satisfies never;
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
      return how satisfies never;
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
      return <>'s thread failed{event.error !== null && `: ${event.error}`}</>;
    case "needs-input":
      return <>waits on you: {event.question}</>;
    default:
      return event satisfies never;
  }
}

const PR_CHANGE: Record<PrChange, (number: number) => string> = {
  opened: (n) => `#${n} opened`,
  reopened: (n) => `#${n} reopened`,
  merged: (n) => `#${n} merged`,
  closed: (n) => `#${n} closed`,
  "ci-passed": (n) => `CI passed on #${n}`,
  "ci-failed": (n) => `CI failed on #${n}`,
  approved: (n) => `#${n} approved`,
  "changes-requested": (n) => `Changes requested on #${n}`,
};
