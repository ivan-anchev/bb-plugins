// A machine event in an issue's feed as a quiet line: who did it, when the entry names someone
// (entry.ts actorOf), what happened, the status it moved the issue to, and when; or a status move no
// moment explains, alone.
import type { ReactNode } from "react";
import { actorOf, type Actor, type Entry } from "../../../../model/feed/entry.ts";
import { STATUS_LABELS } from "../../../../model/issue/status.ts";
import { PR_CHANGE_WORDS } from "../../../../model/verdict/pr.ts";
import { AgentName, MovedTo, Status, When, type FeedAgents } from "./byline.tsx";

/** The entries drawn as lines with a who and a what: everything but rounds, decisions and comments, which are cards, and a status move alone. */
type LineEntry = Exclude<Entry, { kind: "round" | "decision" | "comment" | "moved" }>;

export function EntryLine({ entry, agents }: { entry: LineEntry; agents: FeedAgents }) {
  return (
    <p className="rmi-line">
      <Who actor={actorOf(entry)} agents={agents} />
      {whatOf(entry, agents)}
      <MovedTo status={entry.moved} /> <When at={entry.at} />
    </p>
  );
}

/** A status the issue moved to that no moment explains, as a parent rolling up or a turn ending. */
export function MovedLine({ entry }: { entry: Extract<Entry, { kind: "moved" }> }) {
  return (
    <p className="rmi-line">
      <Status status={entry.status} /> <When at={entry.at} />
    </p>
  );
}

/** Who did it, named where the entry names someone; a line by GitHub, bb or the plugin itself names no one. */
function Who({ actor, agents }: { actor: Actor; agents: FeedAgents }) {
  switch (actor.kind) {
    case "user":
      return <span className="rmi-actor">You </span>;
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
      // why PR_CHANGE_WORDS: the manager's doorbell and catch-up name a change in the same words.
      return `#${entry.number} ${entry.changes.flatMap((change) => PR_CHANGE_WORDS[change] ?? []).join(", ")}`;
    case "thread":
      return <ThreadSaid event={entry.event} />;
    case "unblocked":
      return `Unblocked: ${entry.by}, the last of its dependencies, closed`;
    case "logged":
      return loggedText(entry.event);
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      entry satisfies never;
      return null;
  }
}

/** A change to the plan, by the manager, or where the log began. */
function loggedText(event: Extract<Entry, { kind: "logged" }>["event"]): string {
  switch (event.kind) {
    case "edited":
      // why the fields' own names: they are the words the feed names them by (log-event.ts).
      return `edited ${event.fields.join(", ")}`;
    case "rested":
      // why a setting, not a move: where it rests shows only while no agent's work or sub-issue places it; what it moved to is the status observed (its glyph).
      return `set it to rest in ${STATUS_LABELS[event.rest]}`;
    case "closed":
      return event.as === "canceled" ? "canceled it" : "accepted it as Done";
    case "reopened":
      return "reopened it";
    case "parent-set":
      return event.parentId === null ? "made it top-level" : `set its parent to ${event.parentId}`;
    case "dependency-added":
      return `made it depend on ${event.on}`;
    case "dependency-removed":
      return `removed its dependency on ${event.on}`;
    case "log-began":
      return "Edits and status moves are kept from here; verdict times above are as announced or approximate";
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      event satisfies never;
      return "";
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
