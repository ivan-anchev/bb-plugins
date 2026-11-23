// A comment in an issue's feed: the user's, posted from the tab and sent to the regional manager, or
// a reply from the manager or the agent holding the issue, quoting a line of what it answers.
import type { Comment } from "../../../../model/feed/comment.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { useManager } from "../../../profile/use-manager.ts";
import { AgentName, When, type FeedAgents } from "./byline.tsx";

type CommentCardProps = {
  coordinatorId: CoordinatorId;
  comment: Comment;
  /** The comment it answers, from the same feed (null: it answers none, or that one isn't read yet). */
  answered: Comment | null;
  agents: FeedAgents;
};

export function CommentCard({ coordinatorId, comment, answered, agents }: CommentCardProps) {
  return (
    <article className="rmi-decision" aria-label={`Comment ${comment.id}`}>
      <p className="rmi-decision-head">
        <Author author={comment.author} agents={agents} /> {comment.replyTo === null ? "commented" : `replied to ${comment.replyTo}`} <When at={comment.at} />
        <span className="rmi-decision-id">{comment.id}</span>
      </p>
      {answered !== null && <p className="rmi-comment-quote">{answered.text}</p>}
      <p className="rmi-decision-text">{comment.text}</p>
      {comment.author.kind === "user" && <SentTo coordinatorId={coordinatorId} />}
    </article>
  );
}

/** A comment of the user's on its way, from Send until the feed reads it: a quieter card, saying so. */
export function SendingCard({ text }: { text: string }) {
  return (
    <article className="rmi-decision rmi-comment-sending" aria-label="Your comment, sending">
      <p className="rmi-decision-head">
        <span className="rmi-actor">You</span> commented
      </p>
      <p className="rmi-decision-text">{text}</p>
      <p role="status" className="rmi-verdict-meta">
        Sending…
      </p>
    </article>
  );
}

function Author({ author, agents }: { author: Comment["author"]; agents: FeedAgents }) {
  switch (author.kind) {
    case "user":
      return <span className="rmi-actor">You</span>;
    case "manager":
      return <span className="rmi-actor">Regional manager</span>;
    case "agent":
      return <AgentName agentId={author.agentId} agents={agents} />;
    default:
      // why nothing: the server may be newer than this bundle for a moment after an update.
      author satisfies never;
      return null;
  }
}

/** Where every comment of the user's goes: to the regional manager, by its thread's title while bb lists it. */
function SentTo({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const name = managerName(useManager(coordinatorId));
  return <p className="rmi-verdict-meta">Sent to {name}</p>;
}

/** The regional manager's name as the panel shows it; "the regional manager" while bb doesn't list its thread. */
export const managerName = (manager: ReturnType<typeof useManager>): string => manager?.profile?.name ?? "the regional manager";
