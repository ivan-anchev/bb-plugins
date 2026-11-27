// A comment in an issue's feed: the user's, posted from the tab and sent to the regional manager, or
// a reply from the manager or the agent holding the issue, quoting a line of what it answers. Its
// text, as Markdown, is cut to three lines, opening on press.
import { firstLine, type Comment, type CommentId } from "../../../../model/feed/comment.ts";
import type { Entry } from "../../../../model/feed/entry.ts";
import type { CoordinatorId } from "../../../../model/role.ts";
import { useManagerName } from "../../../profile/use-manager.ts";
import { TabMarkdown } from "../../../ui/tab-markdown/tab-markdown.tsx";
import { When, Who, type FeedAgents } from "./byline.tsx";
import { Clamp } from "./clamp.tsx";

type CommentCardProps = {
  coordinatorId: CoordinatorId;
  entry: Extract<Entry, { kind: "comment" }>;
  /** The comment it answers, from the same feed (null: it answers none). */
  answered: Comment | null;
  agents: FeedAgents;
};

export function CommentCard({ coordinatorId, entry, answered, agents }: CommentCardProps) {
  const { comment } = entry;
  return (
    <article className="rmi-decision" aria-label={`Comment ${comment.id}`}>
      <p className="rmi-decision-head">
        <Who author={comment.author} coordinatorId={coordinatorId} agents={agents} />
        {comment.replyTo === null ? "commented" : `replied to ${comment.replyTo}`} <When at={comment.at} />
        <span className="rmi-decision-id">{comment.id}</span>
      </p>
      {answered !== null && <p className="rmi-comment-quote">{firstLine(answered.text)}</p>}
      <Clamp lines={3} className="rmi-decision-text">
        <TabMarkdown text={comment.text} />
      </Clamp>
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
      <div className="rmi-decision-text">
        <TabMarkdown text={text} />
      </div>
      <p role="status" className="rmi-verdict-meta">
        {commentId === null ? "Sending…" : `Sent as ${commentId}`}
      </p>
    </article>
  );
}

/** Where every comment of the user's goes: to the regional manager, by its thread's title while bb lists it. */
function SentTo({ coordinatorId }: { coordinatorId: CoordinatorId }) {
  return <p className="rmi-verdict-meta">Sent to {useManagerName(coordinatorId)}</p>;
}
