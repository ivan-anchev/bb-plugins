// Who and when, as every entry of an issue's feed names them: an agent by its id, opening its thread
// while bb still has it, and a moment as the board shows times.
import type { IssueFeed } from "../../../../contract.ts";
import type { AgentId } from "../../../../model/agent/agent.ts";
import { shortTime } from "../../../ui/time.ts";
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
