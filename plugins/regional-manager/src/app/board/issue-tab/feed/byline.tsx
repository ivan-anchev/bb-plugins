// Who, when and what it moved the issue to, as every entry of an issue's feed names them: an agent by
// its id, opening its thread while bb still has it; a moment as the board shows times; and the status
// observed after it, as the Board draws a status.
import type { IssueFeed } from "../../../../contract.ts";
import type { AgentId } from "../../../../model/agent/agent.ts";
import type { Actor } from "../../../../model/feed/entry.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../../model/issue/status.ts";
import { shortTime } from "../../../ui/time.ts";
import { StatusGlyph } from "../../issue/status-glyph.tsx";
import { ThreadLink } from "../../issue/thread-link.tsx";

/** The issue's agents, each with its thread (null: none to open), as the feed's read lists them. */
export type FeedAgents = IssueFeed["agents"];

export function AgentName({ agentId, agents }: { agentId: AgentId; agents: FeedAgents }) {
  return <ThreadLink name={agentId} threadId={agents.find(({ id }) => id === agentId)?.threadId ?? null} />;
}

export const When = ({ at }: { at: number }) => (
  <time className="rmi-when" dateTime={new Date(at).toISOString()}>
    {shortTime(at)}
  </time>
);

/** The status the issue moved to after a moment, as " · ◑ Verifying"; nothing when it moved to none. */
export function MovedTo({ status }: { status: IssueStatus | null }) {
  if (status === null) return null;
  return (
    <>
      {" · "}
      <Status status={status} />
    </>
  );
}

/** A status as the Board draws it: its glyph, then its name. why the name hidden from assistive tech: the glyph's label says it. */
export const Status = ({ status }: { status: IssueStatus }) => (
  <span className="rmi-status">
    <StatusGlyph status={status} /> <span aria-hidden>{STATUS_LABELS[status]}</span>
  </span>
);

/** Who did it, named where the entry names someone; a line by GitHub, bb or the plugin itself names no one. */
export function Who({ actor, agents }: { actor: Actor; agents: FeedAgents }) {
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
