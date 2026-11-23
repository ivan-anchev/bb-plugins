// Who, when and what it moved the issue to, as every entry of an issue's feed names them: an agent by
// its id, opening its thread while bb still has it; a moment as the board shows times; and the status
// observed after it, as the Board draws a status.
import type { IssueFeed } from "../../../../contract.ts";
import type { AgentId } from "../../../../model/agent/agent.ts";
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
