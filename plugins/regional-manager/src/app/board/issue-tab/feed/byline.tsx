// Who, when and what it moved the issue to, as an issue's feed names them: the regional manager by
// its avatar and name, as its own thread's row draws it; an agent by its id, opening its thread while
// bb still has it; a moment as the board shows times; and the status a round's step moved the issue
// to, as the Board draws a status.
import type { IssueFeed } from "../../../../contract.ts";
import type { AgentId } from "../../../../model/agent/agent.ts";
import type { CommentAuthor } from "../../../../model/feed/comment.ts";
import { STATUS_LABELS, type IssueStatus } from "../../../../model/issue/status.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { AvatarBlob } from "../../../profile/avatar.tsx";
import { useManager } from "../../../profile/use-manager.ts";
import { shortTime } from "../../../ui/time.ts";
import { StatusGlyph } from "../../issue/status-glyph.tsx";
import { ThreadLink } from "../../issue/thread-link.tsx";

/** The issue's agents, each with its thread (null: none to open), as the feed's read lists them. */
export type FeedAgents = IssueFeed["agents"];

export function AgentName({ agentId, agents }: { agentId: AgentId; agents: FeedAgents }) {
  return <ThreadLink name={agentId} threadId={agents.find(({ id }) => id === agentId)?.threadId ?? null} />;
}

/** The regional manager by its avatar and name; by its role alone before the read, and while bb lists its thread no more. */
export function ManagerName({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const profile = useManager(coordinatorId)?.profile ?? null;
  if (profile === null) return <span className="rmi-actor">Regional manager</span>;
  return (
    <span className="rmi-manager">
      <AvatarBlob avatar={profile.avatar} size="xs" />
      <span className="rmi-actor">{profile.name}</span>
    </span>
  );
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
const Status = ({ status }: { status: IssueStatus }) => (
  <span className="rmi-status">
    <StatusGlyph status={status} /> <span aria-hidden>{STATUS_LABELS[status]}</span>
  </span>
);

/** Who wrote a comment. */
export function Who({ author, coordinatorId, agents }: { author: CommentAuthor; coordinatorId: CoordinatorId; agents: FeedAgents }) {
  switch (author.kind) {
    case "user":
      return <span className="rmi-actor">You </span>;
    case "manager":
      return (
        <>
          <ManagerName coordinatorId={coordinatorId} />{" "}
        </>
      );
    case "agent":
      return (
        <>
          <AgentName agentId={author.agentId} agents={agents} />{" "}
        </>
      );
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      author satisfies never;
      return null;
  }
}
