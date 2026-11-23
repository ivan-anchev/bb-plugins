// A comment in an issue's feed: the user's, posted from the tab and sent to the regional manager, or
// a reply from the manager or the agent holding the issue, quoting a line of what it answers.
import type { Comment, CommentId } from "../../../../model/feed/comment.ts";
import { actorOf, type Entry } from "../../../../model/feed/entry.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { useManager } from "../../../profile/use-manager.ts";
import { When, Who, type FeedAgents } from "./byline.tsx";

type CommentCardProps = {
  coordinatorId: CoordinatorId;
  entry: Extract<Entry, { kind: "comment" }>;
  /** The comment it answers, from the same feed (null: it answers none, or that one isn't read yet). */
  answered: Comment | null;
  agents: FeedAgents;
};

export function CommentCard({ coordinatorId, entry, answered, agents }: CommentCardProps) {
  const { comment } = entry;
  return (
    <article className="rmi-decision" aria-label={`Comment ${comment.id}`}>
      <p className="rmi-decision-head">
        <Who actor={actorOf(entry)} agents={agents} />
        {comment.replyTo === null ? "commented" : `replied to ${comment.replyTo}`} <When at={comment.at} />
        <span className="rmi-decision-id">{comment.id}</span>
      </p>
      {answered !== null && <p className="rmi-comment-quote">{answered.text}</p>}
      <p className="rmi-decision-text">{comment.text}</p>
      {comment.author.kind === "user" && <SentTo coordinatorId={coordinatorId} />}
    </article>
  );
}

/** A comment of the user's from Send until the feed reads it: on its way, or taken by the server as `commentId` (null: not yet). */
export function SendingCard({ text, commentId }: { text: string; commentId: CommentId | null }) {
  return (
    <article className="rmi-decision" aria-label="Your comment">
      <p className="rmi-decision-head">
        <span className="rmi-actor">You</span> commented
      </p>
      <p className="rmi-decision-text">{text}</p>
      <p role="status" className="rmi-verdict-meta">
        {commentId === null ? "Sending…" : `Sent as ${commentId}`}
      </p>
    </article>
  );
}

/** Where every comment of the user's goes: to the regional manager, by its thread's title while bb lists it. */
function SentTo({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  const name = managerName(useManager(coordinatorId));
  return <p className="rmi-verdict-meta">Sent to {name}</p>;
}

/** The regional manager's name as the panel shows it; "the regional manager" while bb doesn't list its thread. */
export const managerName = (manager: ReturnType<typeof useManager>): string => manager?.profile?.name ?? "the regional manager";
